import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseLandmarker as PoseLandmarkerInstance } from '@mediapipe/tasks-vision'
import {
  adaptivePoseSmooth,
  applyHorizontalSensitivity,
  normalizeHorizontalSensitivity,
  resolveAbsoluteLane,
} from '../game/poseControlModel'
import type { CalibrationBaseline, PoseSignal, RunnerLane } from '../game/types'
import {
  createVerticalIntentState,
  normalizeVerticalDisplacement,
  sanitizeTorsoSize,
  updateVerticalIntent,
} from '../game/verticalIntentModel'

export type CameraStatus = 'off' | 'requesting' | 'ready' | 'calibrating' | 'active' | 'error'

interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

interface UsePoseControlsOptions {
  onLaneTarget: (lane: RunnerLane) => void
  onCrouchChange: (crouching: boolean) => void
  onJump: () => void
  horizontalSensitivity: number
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const CALIBRATION_MS = 1200
const TRACKING_LOSS_RELEASE_FRAMES = 4

const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28],
]

const LANE_LABELS = ['LEFT LANE', 'CENTER LANE', 'RIGHT LANE'] as const

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

export function usePoseControls({
  onLaneTarget,
  onCrouchChange,
  onJump,
  horizontalSensitivity,
}: UsePoseControlsOptions) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<PoseLandmarkerInstance | null>(null)
  const frameRef = useRef(0)
  const statusRef = useRef<CameraStatus>('off')
  const baselineRef = useRef<CalibrationBaseline | null>(null)
  const filteredRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const calibrationRef = useRef<{ started: number; x: number[]; y: number[]; torso: number[] } | null>(null)
  const laneRef = useRef<RunnerLane>(1)
  const crouchingRef = useRef(false)
  const verticalIntentRef = useRef(createVerticalIntentState())
  const unreliableFramesRef = useRef(0)
  const lastUiUpdateRef = useRef(0)
  const onLaneTargetRef = useRef(onLaneTarget)
  const onCrouchChangeRef = useRef(onCrouchChange)
  const onJumpRef = useRef(onJump)
  const horizontalSensitivityRef = useRef(normalizeHorizontalSensitivity(horizontalSensitivity))

  // Update synchronously during render so a live slider change reaches the
  // very next camera frame without recalibration or an effect-cycle delay.
  horizontalSensitivityRef.current = normalizeHorizontalSensitivity(horizontalSensitivity)

  const [status, setStatusState] = useState<CameraStatus>('off')
  const [message, setMessage] = useState('Camera is off')
  const [error, setError] = useState<string | null>(null)
  const [calibrationProgress, setCalibrationProgress] = useState(0)
  const [signal, setSignal] = useState<PoseSignal>({
    x: 0,
    y: 0,
    confidence: 0,
    lane: 1,
    crouching: false,
    jumpTriggered: false,
  })

  useEffect(() => {
    onLaneTargetRef.current = onLaneTarget
    onCrouchChangeRef.current = onCrouchChange
    onJumpRef.current = onJump
  }, [onLaneTarget, onCrouchChange, onJump])

  const setStatus = useCallback((next: CameraStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  const drawPose = useCallback((landmarks: Landmark[] | undefined) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const width = video.videoWidth || 640
    const height = video.videoHeight || 480
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    if (!landmarks) return

    context.save()
    context.translate(width, 0)
    context.scale(-1, 1)
    context.lineCap = 'round'
    context.strokeStyle = 'rgba(69, 230, 222, .88)'
    context.lineWidth = Math.max(3, width / 180)
    for (const [from, to] of CONNECTIONS) {
      const start = landmarks[from]
      const end = landmarks[to]
      if (!start || !end || (start.visibility ?? 1) < 0.42 || (end.visibility ?? 1) < 0.42) continue
      context.beginPath()
      context.moveTo(start.x * width, start.y * height)
      context.lineTo(end.x * width, end.y * height)
      context.stroke()
    }
    context.fillStyle = '#ffd84b'
    for (const index of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const point = landmarks[index]
      if (!point || (point.visibility ?? 1) < 0.42) continue
      context.beginPath()
      context.arc(point.x * width, point.y * height, Math.max(4, width / 110), 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }, [])

  const publishTrackingLoss = useCallback((confidence: number, now: number) => {
    unreliableFramesRef.current += 1
    if (
      unreliableFramesRef.current >= TRACKING_LOSS_RELEASE_FRAMES &&
      (crouchingRef.current || verticalIntentRef.current.phase !== 'neutral')
    ) {
      crouchingRef.current = false
      verticalIntentRef.current = createVerticalIntentState(now)
      onCrouchChangeRef.current(false)
    }

    if (now - lastUiUpdateRef.current > 140) {
      lastUiUpdateRef.current = now
      setMessage('Step back so I can see your shoulders and hips')
      setSignal((current) => ({
        ...current,
        confidence,
        crouching: crouchingRef.current,
        jumpTriggered: false,
      }))
    }
  }, [])

  const interpretPose = useCallback((landmarks: Landmark[] | undefined, now: number) => {
    const indices = [11, 12, 23, 24]
    if (!landmarks || indices.some((index) => !landmarks[index])) {
      publishTrackingLoss(0, now)
      return
    }

    const confidence = average(indices.map((index) => landmarks[index].visibility ?? 1))
    if (confidence < 0.5) {
      publishTrackingLoss(confidence, now)
      return
    }
    unreliableFramesRef.current = 0

    const rawCenterX = average(indices.map((index) => landmarks[index].x))
    const mirroredCenterX = 1 - rawCenterX
    const shoulderY = average([landmarks[11].y, landmarks[12].y])
    const hipY = average([landmarks[23].y, landmarks[24].y])
    const torsoSize = sanitizeTorsoSize(hipY - shoulderY)
    const previous = filteredRef.current
    const deltaSeconds = previous ? (now - previous.at) / 1000 : 1 / 30
    const filtered = previous
      ? {
          x: adaptivePoseSmooth(previous.x, mirroredCenterX, deltaSeconds, {
            minAlpha: 0.46,
            maxAlpha: 0.9,
            fullSpeed: 0.72,
            deadband: 0.0014,
          }),
          y: adaptivePoseSmooth(previous.y, shoulderY, deltaSeconds, {
            minAlpha: 0.42,
            maxAlpha: 0.86,
            fullSpeed: 0.72,
            deadband: 0.0012,
          }),
          at: now,
        }
      : { x: mirroredCenterX, y: shoulderY, at: now }
    filteredRef.current = filtered

    if (statusRef.current === 'calibrating') {
      const calibration = calibrationRef.current
      if (!calibration) return
      calibration.x.push(filtered.x)
      calibration.y.push(filtered.y)
      calibration.torso.push(torsoSize)
      const progress = Math.min(1, (now - calibration.started) / CALIBRATION_MS)
      if (now - lastUiUpdateRef.current > 66) {
        lastUiUpdateRef.current = now
        setCalibrationProgress(progress)
        setMessage(progress < 0.98 ? 'Hold your neutral running stance…' : 'Locked in!')
      }
      if (progress >= 1 && calibration.x.length > 8) {
        baselineRef.current = {
          centerX: average(calibration.x.slice(-30)),
          shoulderY: average(calibration.y.slice(-30)),
          torsoSize: sanitizeTorsoSize(average(calibration.torso.slice(-30))),
        }
        laneRef.current = 1
        crouchingRef.current = false
        verticalIntentRef.current = createVerticalIntentState(now)
        calibrationRef.current = null
        onLaneTargetRef.current(1)
        onCrouchChangeRef.current(false)
        setCalibrationProgress(1)
        setSignal({
          x: 0,
          y: 0,
          confidence,
          lane: 1,
          crouching: false,
          jumpTriggered: false,
        })
        setStatus('active')
        setMessage('CENTER LANE')
      }
      return
    }

    const baseline = baselineRef.current
    if (statusRef.current !== 'active' || !baseline) return

    const rawDeltaX = filtered.x - baseline.centerX
    const deltaX = applyHorizontalSensitivity(
      rawDeltaX,
      horizontalSensitivityRef.current,
    )
    const deltaY = normalizeVerticalDisplacement(
      filtered.y - baseline.shoulderY,
      baseline.torsoSize,
    )
    const previousLane = laneRef.current
    const nextLane = resolveAbsoluteLane(deltaX, previousLane)
    const laneChanged = nextLane !== previousLane
    laneRef.current = nextLane

    // This is deliberately sent on every reliable pose frame. The engine treats
    // it as an idempotent absolute destination, not as a queued lane command.
    onLaneTargetRef.current(nextLane)

    const wasCrouching = crouchingRef.current
    const verticalIntent = updateVerticalIntent(deltaY, now, verticalIntentRef.current)
    verticalIntentRef.current = verticalIntent.state
    crouchingRef.current = verticalIntent.crouching
    const crouchChanged = crouchingRef.current !== wasCrouching

    // Like lane position, crouch is a continuously refreshed held state.
    onCrouchChangeRef.current(crouchingRef.current)

    if (verticalIntent.jumpTriggered) onJumpRef.current()

    const urgentUiUpdate = laneChanged || crouchChanged || verticalIntent.jumpTriggered
    if (urgentUiUpdate || now - lastUiUpdateRef.current > 66) {
      lastUiUpdateRef.current = now
      setMessage(
        verticalIntent.jumpTriggered
          ? 'JUMP'
          : crouchingRef.current
            ? 'CROUCH'
            : LANE_LABELS[nextLane],
      )
      setSignal({
        x: deltaX,
        y: deltaY,
        confidence,
        lane: nextLane,
        crouching: crouchingRef.current,
        jumpTriggered: verticalIntent.jumpTriggered,
      })
    }
  }, [publishTrackingLoss, setStatus])

  const poseLoop = useCallback(() => {
    const runFrame = () => {
      const detector = detectorRef.current
      const video = videoRef.current
      if (detector && video && video.readyState >= 2 && !video.paused) {
        const now = performance.now()
        try {
          const result = detector.detectForVideo(video, now)
          const landmarks = result.landmarks[0] as Landmark[] | undefined
          drawPose(landmarks)
          interpretPose(landmarks, now)
        } catch {
          publishTrackingLoss(0, now)
        }
      }
      frameRef.current = requestAnimationFrame(runFrame)
    }
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(runFrame)
  }, [drawPose, interpretPose, publishTrackingLoss])

  const createDetector = useCallback(async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.52,
      minPosePresenceConfidence: 0.52,
      minTrackingConfidence: 0.5,
    }
    try {
      return await PoseLandmarker.createFromOptions(vision, options)
    } catch {
      return PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      })
    }
  }, [])

  const enableCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access a camera. Swipe controls still work.')
      setStatus('error')
      return false
    }

    setError(null)
    setStatus('requesting')
    setMessage('Starting camera and pose model…')
    try {
      const [stream, detector] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        }),
        createDetector(),
      ])
      streamRef.current = stream
      detectorRef.current = detector
      const video = videoRef.current
      if (!video) throw new Error('Camera preview is not available')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
      filteredRef.current = null
      unreliableFramesRef.current = 0
      setStatus('ready')
      setMessage('Camera ready — stand where your shoulders and hips are visible')
      poseLoop()
      return true
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : ''
      const friendly =
        name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow it in Safari settings, or keep playing with swipes.'
          : 'Camera tracking could not start. Check your connection, then try again.'
      setError(friendly)
      setMessage('Camera unavailable')
      setStatus('error')
      return false
    }
  }, [createDetector, poseLoop, setStatus])

  const calibrate = useCallback(() => {
    if (statusRef.current !== 'ready' && statusRef.current !== 'active') return
    const now = performance.now()
    baselineRef.current = null
    filteredRef.current = null
    laneRef.current = 1
    crouchingRef.current = false
    verticalIntentRef.current = createVerticalIntentState(now)
    calibrationRef.current = { started: now, x: [], y: [], torso: [] }
    onCrouchChangeRef.current(false)
    setCalibrationProgress(0)
    setStatus('calibrating')
    setMessage('Hold your neutral running stance…')
  }, [setStatus])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    detectorRef.current?.close()
    detectorRef.current = null
    baselineRef.current = null
    filteredRef.current = null
    calibrationRef.current = null
    laneRef.current = 1
    crouchingRef.current = false
    verticalIntentRef.current = createVerticalIntentState()
    unreliableFramesRef.current = 0
    onCrouchChangeRef.current(false)
    const video = videoRef.current
    if (video) video.srcObject = null
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setSignal({
      x: 0,
      y: 0,
      confidence: 0,
      lane: 1,
      crouching: false,
      jumpTriggered: false,
    })
    setCalibrationProgress(0)
    setError(null)
    setMessage('Camera is off')
    setStatus('off')
  }, [setStatus])

  useEffect(() => stopCamera, [stopCamera])

  return {
    videoRef,
    canvasRef,
    status,
    message,
    error,
    signal,
    calibrationProgress,
    enableCamera,
    calibrate,
    stopCamera,
  }
}

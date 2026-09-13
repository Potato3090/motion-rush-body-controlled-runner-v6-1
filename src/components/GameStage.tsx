import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { RunnerEngine } from '../game/RunnerEngine'
import type { CameraViewMode } from '../game/presentationSettings'
import type { GameSnapshot, GameStatus, RunnerAction, RunnerLane } from '../game/types'

export interface GameStageHandle {
  action: (action: RunnerAction) => void
  setCameraLane: (lane: RunnerLane) => void
  setCameraCrouching: (crouching: boolean) => void
  setManualCrouching: (crouching: boolean) => void
  reset: () => void
}

interface GameStageProps {
  status: GameStatus
  cameraViewMode: CameraViewMode
  onSnapshot: (snapshot: GameSnapshot) => void
  onCrash: (snapshot: GameSnapshot) => void
  onCoin: () => void
}

const GameStage = forwardRef<GameStageHandle, GameStageProps>(function GameStage(
  { status, cameraViewMode, onSnapshot, onCrash, onCoin },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<RunnerEngine | null>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const callbacksRef = useRef({ onSnapshot, onCrash, onCoin })

  useEffect(() => {
    callbacksRef.current = { onSnapshot, onCrash, onCoin }
  }, [onSnapshot, onCrash, onCoin])

  useEffect(() => {
    if (!hostRef.current) return
    const engine = new RunnerEngine(hostRef.current, {
      onSnapshot: (snapshot) => callbacksRef.current.onSnapshot(snapshot),
      onCrash: (snapshot) => callbacksRef.current.onCrash(snapshot),
      onCoin: () => callbacksRef.current.onCoin(),
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setStatus(status)
  }, [status])

  useEffect(() => {
    engineRef.current?.setCameraViewMode(cameraViewMode)
  }, [cameraViewMode])

  useImperativeHandle(ref, () => ({
    action: (action) => engineRef.current?.action(action),
    setCameraLane: (lane) => engineRef.current?.setTargetLane(lane),
    setCameraCrouching: (crouching) => engineRef.current?.setCameraCrouching(crouching),
    setManualCrouching: (crouching) => engineRef.current?.setManualCrouching(crouching),
    reset: () => engineRef.current?.start(),
  }), [])

  const finishGesture = (clientX: number, clientY: number) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) return
    const deltaX = clientX - start.x
    const deltaY = clientY - start.y
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 26) return
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      engineRef.current?.action(deltaX > 0 ? 'right' : 'left')
    } else {
      engineRef.current?.action(deltaY < 0 ? 'jump' : 'slide')
    }
  }

  return (
    <div
      ref={hostRef}
      className="game-stage"
      onPointerDown={(event) => {
        pointerStart.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={(event) => finishGesture(event.clientX, event.clientY)}
      onPointerCancel={() => { pointerStart.current = null }}
    />
  )
})

export default GameStage

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Coins,
  Expand,
  Gauge,
  Hand,
  HeartPulse,
  Info,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import GameStage, { type GameStageHandle } from './components/GameStage'
import { HORIZONTAL_SENSITIVITY } from './game/poseControlModel'
import {
  DEFAULT_CAMERA_VIEW_MODE,
  DEFAULT_SHOW_BODY_TRACKING,
  isCameraDockVisible,
  resolveCameraViewMode,
  type CameraViewMode,
} from './game/presentationSettings'
import { loadHorizontalSensitivity, saveHorizontalSensitivity } from './game/settings'
import type { ControlMode, GameSnapshot, GameStatus, RunnerAction, RunnerLane } from './game/types'
import { usePoseControls } from './hooks/usePoseControls'

const EMPTY_SNAPSHOT: GameSnapshot = { score: 0, coins: 0, distance: 0, speed: 19, multiplier: 1 }

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function App() {
  const stageRef = useRef<GameStageHandle>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [status, setStatus] = useState<GameStatus>('menu')
  const [controlMode, setControlMode] = useState<ControlMode>('touch')
  const [snapshot, setSnapshot] = useState<GameSnapshot>(EMPTY_SNAPSHOT)
  const [finalSnapshot, setFinalSnapshot] = useState<GameSnapshot>(EMPTY_SNAPSHOT)
  const [countdown, setCountdown] = useState(3)
  const [muted, setMuted] = useState(false)
  const [cameraExpanded, setCameraExpanded] = useState(true)
  const [showHowTo, setShowHowTo] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('motion-rush-high-score') || 0))
  const [horizontalSensitivity, setHorizontalSensitivity] = useState(loadHorizontalSensitivity)
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>(DEFAULT_CAMERA_VIEW_MODE)
  const [showBodyTracking, setShowBodyTracking] = useState(DEFAULT_SHOW_BODY_TRACKING)

  const playTone = useCallback((frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.04) => {
    if (muted) return
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = audioContextRef.current ?? new AudioContextClass()
      audioContextRef.current = context
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, context.currentTime)
      gain.gain.setValueAtTime(volume, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + duration)
    } catch {
      // Sound is a bonus. Browser autoplay rules should never stop the game.
    }
  }, [muted])

  const performAction = useCallback((action: RunnerAction) => {
    stageRef.current?.action(action)
  }, [])

  const setCameraLane = useCallback((lane: RunnerLane) => {
    stageRef.current?.setCameraLane(lane)
  }, [])

  const setCameraCrouching = useCallback((crouching: boolean) => {
    stageRef.current?.setCameraCrouching(crouching)
  }, [])

  const performCameraJump = useCallback(() => {
    stageRef.current?.action('jump')
  }, [])

  const pose = usePoseControls({
    onLaneTarget: setCameraLane,
    onCrouchChange: setCameraCrouching,
    onJump: performCameraJump,
    horizontalSensitivity,
  })

  const updateHorizontalSensitivity = useCallback((value: number) => {
    setHorizontalSensitivity(saveHorizontalSensitivity(value))
  }, [])

  const onCoin = useCallback(() => {
    playTone(880, 0.085, 'sine', 0.035)
  }, [playTone])

  const onCrash = useCallback((result: GameSnapshot) => {
    setFinalSnapshot(result)
    setSnapshot(result)
    setStatus('gameover')
    playTone(92, 0.42, 'sawtooth', 0.07)
    if (navigator.vibrate) navigator.vibrate([75, 45, 100])
    setHighScore((current) => {
      const next = Math.max(current, result.score)
      localStorage.setItem('motion-rush-high-score', String(next))
      return next
    })
  }, [playTone])

  const beginRun = useCallback(() => {
    stageRef.current?.reset()
    setSnapshot(EMPTY_SNAPSHOT)
    setCountdown(3)
    setStatus('countdown')
    playTone(330, 0.1, 'square', 0.025)
  }, [playTone])

  useEffect(() => {
    if (status !== 'countdown') return
    const timers = [
      window.setTimeout(() => { setCountdown(2); playTone(392, 0.1, 'square', 0.025) }, 680),
      window.setTimeout(() => { setCountdown(1); playTone(494, 0.1, 'square', 0.025) }, 1360),
      window.setTimeout(() => { setCountdown(0); playTone(740, 0.18, 'square', 0.035) }, 2040),
      window.setTimeout(() => setStatus('playing'), 2320),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [status, playTone])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.target instanceof HTMLInputElement) return
      const actions: Record<string, RunnerAction | undefined> = {
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right',
        ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump',
      }
      if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
        event.preventDefault()
        stageRef.current?.setManualCrouching(true)
        return
      }
      const action = actions[event.key]
      if (action) {
        event.preventDefault()
        performAction(action)
      }
      if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
        setStatus((current) => current === 'playing' ? 'paused' : current === 'paused' ? 'playing' : current)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
        stageRef.current?.setManualCrouching(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [performAction])

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt)
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setStatus((current) => current === 'playing' ? 'paused' : current)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const cameraIsOn = pose.status !== 'off'
  const cameraIsActive = pose.status === 'active'
  const cameraDockMounted = controlMode === 'camera' || cameraIsOn
  const cameraDockVisible = isCameraDockVisible(status, controlMode, cameraIsOn, showBodyTracking)
  const effectiveCameraViewMode = resolveCameraViewMode(controlMode, cameraViewMode)
  const speedPercent = Math.min(100, ((snapshot.speed - 19) / 16) * 100)
  const cameraButton = useMemo(() => {
    if (pose.status === 'off' || pose.status === 'error') return { label: 'Enable body camera', action: pose.enableCamera, icon: Camera }
    if (pose.status === 'requesting') return { label: 'Loading pose tracking…', action: undefined, icon: ScanLine }
    if (pose.status === 'ready') return { label: 'Calibrate neutral pose', action: pose.calibrate, icon: ScanLine }
    if (pose.status === 'calibrating') return { label: 'Hold still…', action: undefined, icon: HeartPulse }
    return { label: 'Recalibrate', action: pose.calibrate, icon: Check }
  }, [pose.status, pose.enableCamera, pose.calibrate])

  const mainAction = async () => {
    if (controlMode === 'camera' && (pose.status === 'off' || pose.status === 'error')) {
      await pose.enableCamera()
      return
    }
    if (controlMode === 'camera' && pose.status === 'ready') {
      pose.calibrate()
      return
    }
    if (controlMode === 'camera' && pose.status === 'calibrating') return
    beginRun()
  }

  const installApp = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  return (
    <main className={`app-shell status-${status} ${cameraDockVisible && cameraExpanded ? 'camera-open' : ''}`}>
      <GameStage
        ref={stageRef}
        status={status}
        cameraViewMode={effectiveCameraViewMode}
        onSnapshot={setSnapshot}
        onCrash={onCrash}
        onCoin={onCoin}
      />
      <div className="sun-glow" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <div className="mini-brand" aria-label="Motion Rush">
          <span className="brand-bolt"><Zap size={15} fill="currentColor" /></span>
          <span>MOTION <b>RUSH</b></span>
        </div>
        <div className="topbar-actions">
          {status !== 'menu' && status !== 'gameover' && (
            <button
              className="icon-button glass"
              onClick={() => setStatus(status === 'paused' ? 'playing' : 'paused')}
              aria-label={status === 'paused' ? 'Resume game' : 'Pause game'}
            >
              {status === 'paused' ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
            </button>
          )}
          <button className="icon-button glass" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Turn sound on' : 'Mute sound'}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </header>

      {(status === 'playing' || status === 'paused' || status === 'countdown') && (
        <section className="hud" aria-label="Game score">
          <div className="score-stack">
            <span className="hud-label">SCORE</span>
            <strong>{formatNumber(snapshot.score)}</strong>
            <span className="multiplier">×{snapshot.multiplier}</span>
          </div>
          <div className="hud-pill coin-pill"><Coins size={16} fill="currentColor" /><b>{snapshot.coins}</b></div>
          <div className="speed-meter" aria-label={`Speed ${Math.round(snapshot.speed)} kilometers per hour`}>
            <div className="speed-head"><Gauge size={14} /><span>{Math.round(snapshot.speed)} KM/H</span></div>
            <div className="speed-track"><i style={{ width: `${speedPercent}%` }} /></div>
          </div>
        </section>
      )}

      {cameraDockMounted && (
        <aside
          className={`camera-dock glass ${cameraExpanded ? 'expanded' : 'collapsed'} ${cameraIsActive ? 'tracking' : ''} ${cameraDockVisible ? '' : 'visualization-hidden'}`}
          aria-hidden={!cameraDockVisible}
        >
          <div className="camera-head">
            <div className="camera-title">
              <span className={`live-dot ${cameraIsActive ? 'is-live' : ''}`} />
              <span>{cameraIsActive ? 'BODY LIVE' : 'BODY CAM'}</span>
            </div>
            <div className="camera-head-actions">
              {cameraIsOn && <button onClick={pose.stopCamera} aria-label="Turn camera off"><CameraOff size={15} /></button>}
              <button onClick={() => setCameraExpanded((value) => !value)} aria-label={cameraExpanded ? 'Minimize camera' : 'Expand camera'}>
                {cameraExpanded ? <ChevronDown size={16} /> : <Expand size={15} />}
              </button>
            </div>
          </div>
          {cameraExpanded && (
            <>
              <div className="camera-frame">
                <video ref={pose.videoRef} autoPlay muted playsInline />
                <canvas ref={pose.canvasRef} />
                {!cameraIsOn && <div className="camera-placeholder"><Camera size={26} /><span>Camera preview</span></div>}
                {pose.status === 'requesting' && <div className="camera-loading"><span className="loader" /> Loading AI pose model</div>}
                {pose.status === 'calibrating' && (
                  <div className="calibration-ring" style={{ '--progress': `${pose.calibrationProgress * 360}deg` } as CSSProperties}>
                    <span>{Math.max(1, Math.ceil((1 - pose.calibrationProgress) * 2))}</span>
                  </div>
                )}
                {cameraIsActive && (
                  <div
                    className="lean-indicator"
                    style={{ '--lean': `${Math.max(-1, Math.min(1, pose.signal.x / 0.1)) * 42}px` } as CSSProperties}
                    aria-hidden="true"
                  ><i /></div>
                )}
              </div>
              <div className="camera-status-line">
                <span>{pose.message}</span>
                {cameraIsActive && (
                  <b>{['LEFT', 'CENTER', 'RIGHT'][pose.signal.lane]} · {Math.round(pose.signal.confidence * 100)}%</b>
                )}
              </div>
              {cameraIsActive && (
                <div className="pose-action-strip" aria-label="Detected body controls">
                  <span className={pose.signal.lane === 0 ? 'active' : ''}><ArrowLeft size={11} /> LEFT</span>
                  <span className={pose.signal.lane === 2 ? 'active' : ''}><ArrowRight size={11} /> RIGHT</span>
                  <span className={pose.signal.jumpTriggered ? 'active' : ''}><ArrowUp size={11} /> JUMP</span>
                  <span className={pose.signal.crouching ? 'active' : ''}><ArrowDown size={11} /> CROUCH</span>
                </div>
              )}
              <label className="sensitivity-control" htmlFor="horizontal-sensitivity">
                <span className="sensitivity-head">
                  <span>Horizontal Sensitivity</span>
                  <output htmlFor="horizontal-sensitivity">{horizontalSensitivity.toFixed(2)}x</output>
                </span>
                <input
                  id="horizontal-sensitivity"
                  type="range"
                  min={HORIZONTAL_SENSITIVITY.min}
                  max={HORIZONTAL_SENSITIVITY.max}
                  step={HORIZONTAL_SENSITIVITY.step}
                  value={horizontalSensitivity}
                  onInput={(event) => updateHorizontalSensitivity(Number(event.currentTarget.value))}
                  aria-valuetext={`${horizontalSensitivity.toFixed(2)} times`}
                  style={{
                    '--sensitivity-fill': `${((horizontalSensitivity - HORIZONTAL_SENSITIVITY.min) / (HORIZONTAL_SENSITIVITY.max - HORIZONTAL_SENSITIVITY.min)) * 100}%`,
                  } as CSSProperties}
                />
                <span className="sensitivity-scale" aria-hidden="true">
                  <span>0.50x</span><span>1.00x</span><span>2.00x</span>
                </span>
              </label>
              {pose.error && <p className="camera-error">{pose.error}</p>}
              {(status === 'menu' || status === 'paused') && cameraButton.action && (
                <button className="dock-action" onClick={() => cameraButton.action?.()}>
                  <cameraButton.icon size={16} /> {cameraButton.label}
                </button>
              )}
            </>
          )}
        </aside>
      )}

      {status === 'menu' && (
        <section className="menu-panel">
          <div className="eyebrow"><span /> BODY-CONTROLLED RUNNER <span /></div>
          <h1>MOTION<br /><em>RUSH</em></h1>
          <p className="tagline">MOVE YOUR BODY. <b>OWN THE TRACK.</b></p>

          <div className="control-picker" role="radiogroup" aria-label="Choose controls">
            <button
              className={controlMode === 'touch' ? 'selected' : ''}
              onClick={() => setControlMode('touch')}
              role="radio"
              aria-checked={controlMode === 'touch'}
            >
              <span className="control-icon"><Hand size={22} /></span>
              <span><b>SWIPE</b><small>Touch + keyboard</small></span>
              {controlMode === 'touch' && <Check className="picker-check" size={15} />}
            </button>
            <button
              className={controlMode === 'camera' ? 'selected camera-choice' : 'camera-choice'}
              onClick={() => { setControlMode('camera'); setCameraExpanded(true) }}
              role="radio"
              aria-checked={controlMode === 'camera'}
            >
              <span className="control-icon"><Camera size={22} /></span>
              <span><b>BODY CAM</b><small>Move to control</small></span>
              <i className="new-chip">AI</i>
              {controlMode === 'camera' && <Check className="picker-check" size={15} />}
            </button>
          </div>

          {controlMode === 'camera' && cameraIsActive && (
            <section className="run-settings glass" aria-label="Body run settings">
              <fieldset>
                <legend>Camera View</legend>
                <div className="segmented-control" role="radiogroup" aria-label="Camera view">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={cameraViewMode === 'third-person'}
                    className={cameraViewMode === 'third-person' ? 'selected' : ''}
                    onClick={() => setCameraViewMode('third-person')}
                  >
                    Third Person
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={cameraViewMode === 'runner-pov'}
                    className={cameraViewMode === 'runner-pov' ? 'selected' : ''}
                    onClick={() => setCameraViewMode('runner-pov')}
                  >
                    Runner POV
                  </button>
                </div>
              </fieldset>
              <div className="tracking-setting">
                <span id="show-body-tracking-label">Show Body Tracking</span>
                <button
                  type="button"
                  className="tracking-switch"
                  role="switch"
                  aria-labelledby="show-body-tracking-label"
                  aria-checked={showBodyTracking}
                  onClick={() => setShowBodyTracking((value) => !value)}
                >
                  <span className={!showBodyTracking ? 'selected' : ''}>Off</span>
                  <span className={showBodyTracking ? 'selected' : ''}>On</span>
                </button>
              </div>
            </section>
          )}

          <button
            className="primary-button"
            onClick={mainAction}
            disabled={pose.status === 'requesting' || pose.status === 'calibrating'}
          >
            <span className="play-disc">
              {controlMode === 'camera' && !cameraIsActive ? <Camera size={21} /> : <Play size={21} fill="currentColor" />}
            </span>
            <span>
              <b>
                {controlMode === 'touch' ? 'START RUN' :
                  pose.status === 'off' || pose.status === 'error' ? 'ENABLE CAMERA' :
                  pose.status === 'ready' ? 'CALIBRATE' :
                  pose.status === 'calibrating' ? 'HOLD STILL…' : 'START BODY RUN'}
              </b>
              <small>
                {controlMode === 'touch' ? 'Swipe any direction' :
                  cameraIsActive ? 'Camera is calibrated' : 'Video stays on this device'}
              </small>
            </span>
            <ArrowRight className="button-arrow" size={22} />
          </button>

          <div className="menu-links">
            <button onClick={() => setShowHowTo(true)}><Info size={15} /> HOW TO PLAY</button>
            {installPrompt ? (
              <button onClick={installApp}><Smartphone size={15} /> INSTALL APP</button>
            ) : (
              <span><Smartphone size={14} /> iPHONE: SHARE → ADD TO HOME</span>
            )}
          </div>
          <div className="privacy-note"><ShieldCheck size={14} /> Pose detection runs in your browser. No video is uploaded.</div>
        </section>
      )}

      {status === 'countdown' && (
        <div className="countdown" aria-live="assertive">
          <span>{countdown === 0 ? 'GO!' : countdown}</span>
          <small>{controlMode === 'camera' && cameraIsActive ? 'MOVE WITH INTENT' : 'SWIPE TO MOVE'}</small>
        </div>
      )}

      {status === 'paused' && (
        <section className="modal-card pause-card glass">
          <span className="modal-icon"><Pause size={25} fill="currentColor" /></span>
          <p className="modal-kicker">TAKE A BREATH</p>
          <h2>Run paused</h2>
          <div className="pause-stats"><span><b>{snapshot.distance}</b> M</span><span><b>{snapshot.coins}</b> COINS</span></div>
          <button className="primary-button compact" onClick={() => setStatus('playing')}>
            <span className="play-disc"><Play size={19} fill="currentColor" /></span><b>RESUME</b>
          </button>
          <button className="text-button" onClick={() => setStatus('menu')}>END RUN</button>
        </section>
      )}

      {status === 'gameover' && (
        <section className="modal-card result-card">
          <div className="result-ribbon"><Trophy size={15} fill="currentColor" /> RUN COMPLETE</div>
          <h2>{finalSnapshot.score >= highScore && finalSnapshot.score > 0 ? 'NEW BEST!' : 'NICE RUN!'}</h2>
          <div className="final-score"><span>SCORE</span><strong>{formatNumber(finalSnapshot.score)}</strong></div>
          <div className="result-grid">
            <div><Coins size={20} /><span>COINS<b>{finalSnapshot.coins}</b></span></div>
            <div><Maximize2 size={20} /><span>DISTANCE<b>{finalSnapshot.distance} M</b></span></div>
            <div><Zap size={20} /><span>BEST<b>{formatNumber(highScore)}</b></span></div>
          </div>
          <button className="primary-button compact" onClick={beginRun}>
            <span className="play-disc"><RotateCcw size={19} /></span><b>RUN AGAIN</b><ArrowRight className="button-arrow" size={20} />
          </button>
          <button className="text-button" onClick={() => setStatus('menu')}>BACK TO HOME</button>
        </section>
      )}

      {status === 'playing' && (
        <div className={`touch-controls ${controlMode === 'camera' && cameraIsActive ? 'backup-controls' : ''}`} aria-label="Runner controls">
          <button onPointerDown={() => performAction('left')} aria-label="Move left"><ArrowLeft /></button>
          <div>
            <button onPointerDown={() => performAction('jump')} aria-label="Jump"><ArrowUp /></button>
            <button
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                stageRef.current?.setManualCrouching(true)
              }}
              onPointerUp={() => stageRef.current?.setManualCrouching(false)}
              onPointerCancel={() => stageRef.current?.setManualCrouching(false)}
              aria-label="Hold to crouch"
            ><ArrowDown /></button>
          </div>
          <button onPointerDown={() => performAction('right')} aria-label="Move right"><ArrowRight /></button>
        </div>
      )}

      {showHowTo && (
        <div className="dialog-backdrop" onClick={() => setShowHowTo(false)}>
          <section className="how-card" role="dialog" aria-modal="true" aria-labelledby="how-title" onClick={(event) => event.stopPropagation()}>
            <button className="dialog-close" onClick={() => setShowHowTo(false)} aria-label="Close instructions"><X /></button>
            <p className="modal-kicker">QUICK START</p>
            <h2 id="how-title">Your body is the controller.</h2>
            <div className="move-grid">
              <div><ArrowLeft /><b>MOVE LEFT</b><span>Your position selects the left lane</span></div>
              <div><ArrowRight /><b>MOVE RIGHT</b><span>Your position selects the right lane</span></div>
              <div><ArrowUp /><b>POP UP</b><span>Jump over barriers</span></div>
              <div><ArrowDown /><b>DUCK</b><span>Slide under signs</span></div>
            </div>
            <div className="setup-tips">
              <h3><Settings2 size={17} /> BEST CAMERA SETUP</h3>
              <p>Prop your phone up, step back until shoulders and hips are visible, then hold a relaxed center stance while calibrating. Your live horizontal position maps directly to the three lanes.</p>
            </div>
            <p className="fallback-tip"><Hand size={16} /> Swipes, arrow keys, and the on-screen buttons always work as backup controls.</p>
            <button className="primary-button compact" onClick={() => setShowHowTo(false)}><Check size={18} /><b>GOT IT</b></button>
          </section>
        </div>
      )}

      <div className="rotate-hint"><Smartphone size={28} /><b>Turn your phone upright</b><span>Motion Rush plays best in portrait.</span></div>
    </main>
  )
}

export default App

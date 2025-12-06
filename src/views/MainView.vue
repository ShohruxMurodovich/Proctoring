<template>
  <div class="container">
    <!-- Fullscreen Modal Component -->
    <FullscreenModal
      @fullscreenExit="handleFullscreenExit"
      @tabSwitch="handleTabSwitch"
      @appSwitch="handleAppSwitch"
      @pageLeave="handlePageLeave"
      @screenRecordingStarted="handleScreenRecordingStarted"
    />

    <div class="camera-container">
      <video ref="video" class="video" autoplay muted playsinline></video>
      <div class="overlay">
        <canvas ref="overlay"></canvas>
      </div>
      <div :class="isInside ? 'inside' : 'outside'">
        {{ text ? text : "YAXSHI" }}
      </div>

    </div>
  </div>

</template>

<script lang="ts" setup >
import { ref, onMounted } from 'vue'
import * as faceapi from 'face-api.js'
import FullscreenModal from '@/components/FullscreenModal.vue'

const video = ref<HTMLVideoElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)
const isInside = ref<boolean>(false)
const realUser = ref<boolean>(false)
const text = ref<string>("")

// Monitoring violation states
const violationCount = ref<number>(0)
const isFullscreenMode = ref<boolean>(false)
// Screen recording
const screenStream = ref<MediaStream | null>(null)
let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024 // 256MB
const isRecording = ref<boolean>(false)
let photoInterval: number | null = null

// Microphone and audio monitoring
const audioStream = ref<MediaStream | null>(null)
const audioContext = ref<AudioContext | null>(null)
const analyser = ref<AnalyserNode | null>(null)
const microphone = ref<MediaStreamAudioSourceNode | null>(null)
const bandpass = ref<BiquadFilterNode | null>(null)
const isMicrophoneActive = ref<boolean>(false)
const audioLevel = ref<number>(0)
const isSpeaking = ref<boolean>(false)
// Adaptive noise gate & hysteresis
const noiseFloor = ref<number>(0)
const rmsLevel = ref<number>(0)
const calibrating = ref<boolean>(true)
let calibrationValues: number[] = []
let lastMicViolationAt = 0
let attackFrames = 0
let releaseFrames = 0


// Smoothing variables for better stability
const earHistory = ref<number[]>([])
const pitchHistory = ref<number[]>([])
const turnHistory = ref<number[]>([])
const HISTORY_LENGTH = 5  // Number of frames to average

// Unified violation reporter
function reportViolation(message: string) {
  violationCount.value++
  isInside.value = false
  text.value = `${message} (${violationCount.value}-chi marta)`
}
function getEAR(eye: faceapi.Point[]) {
  // Guard: 68-landmarks eye arrays have 6 points. If fewer, return neutral EAR.
  if (!eye || eye.length < 6) return 1
  // Standard EAR with 6 points (ref: Soukupová and Čech)
  const p2p6 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y)
  const p3p5 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y)
  const p1p4 = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y)
  if (p1p4 === 0) return 1
  return (p2p6 + p3p5) / (2.0 * p1p4)
}

// Microphone setup and audio monitoring
async function setupMicrophone() {
  try {
    // Request microphone permission
    audioStream.value = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    // Create audio context
    audioContext.value = new (window.AudioContext || (window as unknown as Window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    analyser.value = audioContext.value.createAnalyser()
    microphone.value = audioContext.value.createMediaStreamSource(audioStream.value)
    bandpass.value = audioContext.value.createBiquadFilter()
    bandpass.value.type = 'bandpass'
    bandpass.value.frequency.value = 1200 // center in speech band
    bandpass.value.Q.value = 0.8

    // Configure analyser
    analyser.value.fftSize = 1024
    analyser.value.smoothingTimeConstant = 0.7
    // mic -> bandpass -> analyser
    microphone.value.connect(bandpass.value)
    bandpass.value.connect(analyser.value)

    isMicrophoneActive.value = true
    startAudioMonitoring()

  } catch (error) {
    console.error('Microphone access denied:', error)
    isMicrophoneActive.value = false
    text.value = "Mikrofon ruxsati berilmadi!"
  }
}

// Audio level monitoring
function startAudioMonitoring() {
  if (!analyser.value) return

  const freqLen = analyser.value.frequencyBinCount
  const freqData = new Uint8Array(freqLen)
  const timeLen = analyser.value.fftSize
  const timeData = new Uint8Array(timeLen)

  function checkAudioLevel() {
    if (!analyser.value) return
    // Pull time-domain for RMS
    analyser.value.getByteTimeDomainData(timeData)
    let sumSquares = 0
    for (let i = 0; i < timeLen; i++) {
      const v = (timeData[i] - 128) / 128 // -1..1
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / timeLen)
    rmsLevel.value = rms
    // Also keep a simple freq average for UI/debug
    analyser.value.getByteFrequencyData(freqData)
    let sum = 0
    for (let i = 0; i < freqLen; i++) sum += freqData[i]
    audioLevel.value = sum / freqLen

    // Calibration for adaptive noise floor (first ~1.5s)
    if (calibrating.value) {
      calibrationValues.push(rms)
      if (calibrationValues.length > 90) { // ~90 frames
        const mean = calibrationValues.reduce((a, b) => a + b, 0) / calibrationValues.length
        const variance = calibrationValues.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / calibrationValues.length
        const std = Math.sqrt(variance)
        noiseFloor.value = mean + std * 2 // gate above ambient
        calibrating.value = false
        calibrationValues = []
      }
      requestAnimationFrame(checkAudioLevel)
      return
    }

    // Hysteresis thresholds
    const attackThreshold = noiseFloor.value * 1.6
    const releaseThreshold = noiseFloor.value * 1.2

    if (rms > attackThreshold) {
      attackFrames += 1
      releaseFrames = Math.max(releaseFrames - 1, 0)
    } else if (rms < releaseThreshold) {
      releaseFrames += 1
      attackFrames = Math.max(attackFrames - 1, 0)
    }

    // Determine speaking state with sustain
    const ATTACK_COUNT = 10 // ~10 frames
    const RELEASE_COUNT = 15
    if (attackFrames > ATTACK_COUNT) {
      isSpeaking.value = true
    } else if (releaseFrames > RELEASE_COUNT) {
      isSpeaking.value = false
    }

    // Violation only if speaking is sustained and cooldown passed
    const now = Date.now()
    if (isSpeaking.value && now - lastMicViolationAt > 5000) {
      reportViolation('Mikrofon: gaplashish aniqlandi')
      lastMicViolationAt = now
    }

    requestAnimationFrame(checkAudioLevel)
  }

  checkAudioLevel()
}

async function install() {
  await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
  await faceapi.nets.faceLandmark68Net.loadFromUri('/models')

  // Request both camera and microphone
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 300 },
      height: { ideal: 300 },
      facingMode: 'user'
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })

  // Setup microphone monitoring
  await setupMicrophone()
  if (video.value) {
    video.value.srcObject = stream
    video.value.addEventListener('play', () => {
      if (!video.value) return
      // start auto photo uploads every 30s
      if (!photoInterval) {
        photoInterval = window.setInterval(() => { void takeAndUploadPhoto() }, 30000)
      }

      const canvas = faceapi.createCanvasFromMedia(video.value)
      const context = canvas.getContext('2d')
      if (context) {
        context.strokeStyle = 'red'
      }
      if (overlay.value) {
        overlay.value.replaceWith(canvas)
        overlay.value = canvas
      }

    const displaySize = {
      width: video.value.videoWidth,
      height: video.value.videoHeight
    }

    canvas.width = displaySize.width
    canvas.height = displaySize.height

    faceapi.matchDimensions(canvas, displaySize)

    setInterval(async () => {
      if (!video.value || !context) return

      const detections = await faceapi.detectAllFaces(video.value, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks()
      const resized = faceapi.resizeResults(detections, displaySize)
      context.clearRect(0, 0, canvas.width, canvas.height)

      // Dumaloq markaz va radius
      const cx = displaySize.width / 2
      const cy = displaySize.height / 2
      const r = 148
      // Dumaloqni chizish
      if (context) {
        context.beginPath()
        context.arc(cx, cy, r, 0, 2 * Math.PI)
        context.strokeStyle = isInside.value ? 'green' : 'red'
        context.lineWidth = 4
        context.stroke()
      }

      // Agar yuz aniqlangan bo‘lsa
      if (resized.length > 0) {
        const { x, y, width, height } = resized[0].detection.box
        const centerX = x + width / 2
        const centerY = y + height / 2

        const dx = centerX - cx
        const dy = centerY - cy
        const distance = Math.sqrt(dx * dx + dy * dy)

        const faceArea = width * height
        const distanceFromCamera = calculateDistanceFromSize(faceArea)

        if (distanceFromCamera < 300) {  // 30cm - juda yaqin
          text.value = "Kameradan uzoqlashing (juda yaqin)"
          isInside.value = false
        }
        else if (distanceFromCamera > 800) {  // 80cm - juda uzoq
          text.value = "Kameraga yaqinlashing (juda uzoq)"
          isInside.value = false
        }
        else {
          isInside.value = distance < r
          text.value = ""
          if (detections[0]) {
            const landmarks = detections[0].landmarks

            // Check liveness first
            const isAlive = checkLiveness()
            if (!isAlive) {
              return // Skip other checks if liveness fails
            }

            const leftEye = landmarks.getLeftEye()
            const rightEye = landmarks.getRightEye()
            const nose = landmarks.getNose()

            // Improved head turn detection using multiple points
            const leftEyeCenter = {
              x: leftEye.reduce((sum, point) => sum + point.x, 0) / leftEye.length,
              y: leftEye.reduce((sum, point) => sum + point.y, 0) / leftEye.length
            }
            const rightEyeCenter = {
              x: rightEye.reduce((sum, point) => sum + point.x, 0) / rightEye.length,
              y: rightEye.reduce((sum, point) => sum + point.y, 0) / rightEye.length
            }
            const noseTip = nose[3]

            // Calculate head turn using eye centers and nose tip
            const eyeCenterX = (leftEyeCenter.x + rightEyeCenter.x) / 2

            // Distance from nose tip to eye center line
            const offsetX = noseTip.x - eyeCenterX

            // Calculate angle of head turn
            const eyeDistance = Math.sqrt(Math.pow(rightEyeCenter.x - leftEyeCenter.x, 2) + Math.pow(rightEyeCenter.y - leftEyeCenter.y, 2))
            const normalizedOffset = offsetX / eyeDistance

            // Apply smoothing to reduce jitter
            const smoothedTurn = smoothValue(turnHistory.value, normalizedOffset)
            const smoothedPitch = smoothValue(pitchHistory.value, estimatePitch(landmarks))

            const HEAD_TURN_THRESHOLD = 0.15  // More accurate threshold
            const facingStraight = Math.abs(smoothedTurn) < HEAD_TURN_THRESHOLD

            if (smoothedPitch > 15) {  // Adjusted thresholds for better sensitivity
              isInside.value = false
              text.value = "Kameraga to'g'ri qarang (Tepaga buring)"
            }
            else if (smoothedPitch < -15) {  // Negative values for looking down
              isInside.value = false
              text.value = "Kameraga to'g'ri qarang (Pastga buring)"
            }
            else if (facingStraight) {
              isInside.value = true
              text.value = ""
              const leftEAR = getEAR(leftEye)
              const rightEAR = getEAR(rightEye)
              const avgEAR = (leftEAR + rightEAR) / 2

              // Apply smoothing to EAR values
              const smoothedEAR = smoothValue(earHistory.value, avgEAR)

              // Improved blink detection with dynamic threshold
              const BLINK_THRESHOLD = 0.22  // Adjusted for better sensitivity
              const isBlinking = smoothedEAR < BLINK_THRESHOLD

              // Additional validation: check if both eyes are blinking consistently
              const earDifference = Math.abs(leftEAR - rightEAR)
              const consistentBlink = earDifference < 0.05  // Eyes should blink together

              if (isBlinking && consistentBlink) {
                isInside.value = false
                realUser.value = true
                text.value = "Ko'zlarni oching"
              }
              else if (!consistentBlink && isBlinking) {
                // One eye might be partially closed, but not both
                text.value = "Ko'zlarni to'liq oching"
                isInside.value = false
              }
              else {
                isInside.value = true
                text.value = ""
              }
            }
            else {
              isInside.value = false
              if (smoothedTurn > 0) {
                text.value = "Kameraga to'g'ri qarang (O'nga buriling)"
              }
              else {
                text.value = "Kameraga to'g'ri qarang (Chapga buriling)"
              }
            }
          }
        }
      } else {
        isInside.value = false
        text.value = "Yuz aniqlanmadi...!"
      }
    }, 200)
  })
  }
}

function estimatePitch(landmarks: faceapi.FaceLandmarks68) {
  const nose = landmarks.getNose()
  const jaw = landmarks.getJawOutline()
  const leftEye = landmarks.getLeftEye()
  const rightEye = landmarks.getRightEye()

  // Calculate eye centers more accurately
  const leftEyeCenter = {
    x: leftEye.reduce((sum, point) => sum + point.x, 0) / leftEye.length,
    y: leftEye.reduce((sum, point) => sum + point.y, 0) / leftEye.length
  }
  const rightEyeCenter = {
    x: rightEye.reduce((sum, point) => sum + point.x, 0) / rightEye.length,
    y: rightEye.reduce((sum, point) => sum + point.y, 0) / rightEye.length
  }

  const eyeCenterY = (leftEyeCenter.y + rightEyeCenter.y) / 2

  // Use nose tip and chin for pitch calculation
  const noseTip = nose[3]
  const chinPoint = jaw[8]  // Chin center

  // Calculate face orientation using multiple reference points
  const faceHeight = chinPoint.y - eyeCenterY
  const noseOffset = noseTip.y - eyeCenterY

  // Normalize the offset relative to face size
  const normalizedOffset = noseOffset / faceHeight

  // Convert to degrees with better calibration
  const pitchDegrees = normalizedOffset * 60  // Adjusted for better sensitivity

  // Add stability by considering nose bridge (point 1)
  const noseBridge = nose[1]
  const bridgeOffset = noseBridge.y - eyeCenterY
  const normalizedBridgeOffset = bridgeOffset / faceHeight
  const bridgePitch = normalizedBridgeOffset * 60

  // Average both calculations for stability
  const finalPitch = (pitchDegrees + bridgePitch) / 2

  return finalPitch
}

// Smoothing function for values
function smoothValue(history: number[], newValue: number, maxLength: number = HISTORY_LENGTH): number {
  history.push(newValue)
  if (history.length > maxLength) {
    history.shift()
  }

  // Calculate weighted average (recent values have more weight)
  let weightedSum = 0
  let totalWeight = 0
  for (let i = 0; i < history.length; i++) {
    const weight = i + 1  // More weight for recent values
    weightedSum += history[i] * weight
    totalWeight += weight
  }

  return weightedSum / totalWeight
}

// Liveness helpers removed (detectLiveness, calculateMouthOpenness) — liveness disabled

// Check if person is real (not a photo/video)
function checkLiveness(): boolean {
  // Liveness check disabled per request. Always allow flow to continue.
  return true
}

function calculateDistanceFromSize(faceArea: number) {
  const referenceArea = 15000  // Adjusted for better accuracy
  const referenceDistance = 600  // 60cm in mm
  const distance = referenceDistance * Math.sqrt(referenceArea / faceArea)
  return distance
}

// Event handlers for monitoring violations
const handleFullscreenExit = () => {
  isFullscreenMode.value = false
  reportViolation("Fullscreen'dan chiqdingiz")
  console.log('Fullscreen exited - violation detected')
}

const handleTabSwitch = () => {
  reportViolation("Boshqa tab'ga o'tdingiz")
  console.log('Tab switch detected - violation')
}

const handleAppSwitch = () => {
  reportViolation("Boshqa ilovaga o'tdingiz")
  console.log('App switch detected - violation')
}

const handlePageLeave = () => {
  reportViolation('Sahifani tark etishga harakat qildingiz')
  console.log('Page leave attempt detected - violation')
}

// Enhanced monitoring for page visibility and focus
const setupEnhancedMonitoring = () => {
  // Monitor page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isFullscreenMode.value) {
      handleTabSwitch()
    }
  })

  // Monitor window focus changes
  window.addEventListener('blur', () => {
    if (isFullscreenMode.value) {
      handleAppSwitch()
    }
  })

  // Monitor fullscreen changes
  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = !!(
      document.fullscreenElement ||
      (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
      (document as Document & { msFullscreenElement?: Element }).msFullscreenElement
    )

    isFullscreenMode.value = isFullscreen

    if (!isFullscreen && isFullscreenMode.value) {
      handleFullscreenExit()
    }
  })

  // Monitor beforeunload (page navigation attempts)
  window.addEventListener('beforeunload', (event) => {
    if (isFullscreenMode.value) {
      handlePageLeave()
      event.preventDefault()
      event.returnValue = 'Imtixonni tark etish mumkin emas!'
      return 'Imtixonni tark etish mumkin emas!'
    }
  })

  // Monitor keyboard shortcuts that might be used to cheat
  document.addEventListener('keydown', (event) => {
    if (isFullscreenMode.value) {
      // Block common keyboard shortcuts
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 't': // Ctrl+T (new tab)
          case 'w': // Ctrl+W (close tab)
          case 'r': // Ctrl+R (refresh)
          case 'n': // Ctrl+N (new window)
          case 'l': // Ctrl+L (address bar)
            event.preventDefault()
            reportViolation('Taqiqlangan tugma kombinatsiyasi')
            break
          case 'Tab': // Alt+Tab (app switching)
            if (event.altKey) {
              event.preventDefault()
              handleAppSwitch()
            }
            break
        }
      }

      // Block F11 (fullscreen toggle)
      if (event.key === 'F11') {
        event.preventDefault()
        reportViolation('Fullscreen tugmasini ishlatish taqiqlangan')
      }
    }
  })
}

onMounted(() => {
  install()
  setupEnhancedMonitoring()
  // Clear auto-photo on unload
  window.addEventListener('beforeunload', () => {
    if (photoInterval) {
      clearInterval(photoInterval)
      photoInterval = null
    }
  })
})

// Capture a still photo from the video and upload to the same API endpoint
async function takeAndUploadPhoto() {
  try {
    if (!video.value) return
    const v = video.value
    const canvas = document.createElement('canvas')
    // Use current video dimensions
    const w = v.videoWidth || 640
    const h = v.videoHeight || 480
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, w, h)
    // Encode as JPEG to keep size small
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.8))
    if (!blob) return
    // Enforce a size cap (use ~2MB)
    if (blob.size > 2 * 1024 * 1024) {
      text.value = 'Rasm juda katta. Iltimos qayta urinib ko\'ring.'
      return
    }
    const filename = `photo-${Date.now()}.jpg`
    const formData = new FormData()
    formData.append('file', blob, filename)
    console.log('Uploading photo to /public/files/upload/category/exam/video ...')
    const response = await fetch('https://proctor.platon.uz/services/platon-core/web/v1/public/files/upload/category/exam_video', {
      method: 'POST',
      body: formData
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('Photo upload failed', { status: response.status, errText })
      text.value = `Rasm yuklash xatosi: ${response.status}`
      return
    }
    const data: unknown = await response.json().catch(() => ({}))
    console.log('Photo upload success', { response: data })
    text.value = 'Rasm muvaffaqiyatli yuklandi.'
  } catch (err) {
    console.error('Photo upload exception', err)
    text.value = 'Rasm yuklashda xatolik yuz berdi.'
  }
}

// Handle screen recording stream from modal
function handleScreenRecordingStarted(stream: MediaStream) {
  screenStream.value = stream
  // Auto-start recording after navigation into page
  try {
    recordedChunks = []
    // Target total bitrate ~400-500 kbps, fps ~12, resolution ~640x360
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: 450_000,
      audioBitsPerSecond: 48_000
    }

    // Downscale and lower frame rate on the track if supported
    const vTrack = stream.getVideoTracks()[0]
    try {
      if (vTrack) {
        void vTrack.applyConstraints({
          width: { ideal: 640, max: 640 },
          height: { ideal: 360, max: 360 },
          frameRate: 12
        })
      }
    } catch {}

    const tryTypes = [
      'video/mp4;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]
    type MediaRecorderCtor = typeof MediaRecorder & { isTypeSupported?: (type: string) => boolean }
    const MRctor = MediaRecorder as MediaRecorderCtor
    const isSupported = typeof MRctor.isTypeSupported === 'function'
    if (isSupported && MRctor.isTypeSupported) {
      const supportedType = tryTypes.find(t => MRctor.isTypeSupported && MRctor.isTypeSupported(t))
      mediaRecorder = supportedType ? new MediaRecorder(stream, { ...options, mimeType: supportedType }) : new MediaRecorder(stream, options)
    } else {
      mediaRecorder = new MediaRecorder(stream, options)
    }
  } catch {
    // Fallback mimeType
    mediaRecorder = new MediaRecorder(stream)
  }
  if (!mediaRecorder) return
  mediaRecorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data)
  }
  mediaRecorder.onstop = () => {
    // Build final blob from accumulated chunks
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' })
    // Clear chunks buffer now that blob is created
    recordedChunks = []
    // Trigger upload
    uploadRecordedVideo(blob)
    isRecording.value = false
  }
  mediaRecorder.start(1000)
  isRecording.value = true
  // Stop when user stops sharing
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    stopScreenRecording()
  })
  // Also stop on unload
  window.addEventListener('beforeunload', stopScreenRecording)
}

function stopScreenRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    console.log('Stopping recording and finalizing blob...')
    mediaRecorder.stop()
  }
  screenStream.value?.getTracks().forEach(t => t.stop())
  screenStream.value = null

  window.removeEventListener('beforeunload', stopScreenRecording)
}

async function uploadRecordedVideo(blob: Blob) {
  try {
    console.log('Uploading video started', { sizeBytes: blob.size })
    if (blob.size > MAX_UPLOAD_BYTES) {
      text.value = 'Video hajmi 256MB dan katta. Qisqartiring.'
      console.warn('Upload aborted: file too large for limit', { limitBytes: MAX_UPLOAD_BYTES })
      return
    }

    const filename = `screen-recording-${Date.now()}.webm`
    const formData = new FormData()
    formData.append('file', blob, filename)

    const response = await fetch('https://proctor.platon.uz/services/platon-core/web/v1/public/files/upload/category/exam_video', {
      method: 'post',
      body: formData
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      text.value = `Video yuklash xatosi: ${response.status} ${errText}`
      console.error('Upload failed', { status: response.status, errText })
      return
    }

    const data: unknown = await response.json().catch(() => ({}))

    text.value = 'Ekran yozuvi muvaffaqiyatli yuklandi.'
    console.log('Upload success', { response: data })
  } catch (err) {
    console.error('Upload failed (exception)', err)
    text.value = 'Video yuklashda xatolik yuz berdi.'
  }
}
</script>

<style scoped>
.container {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.camera-container {
  position: relative;
  width: 300px;
  height: 300px;
  margin: auto;
}

.video {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 50%;
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
}

.inside {
  margin-top: 10px;
  color: green;
  font-weight: bold;
  text-align: center;
}

.outside {
  margin-top: 10px;
  color: red;
  font-weight: bold;
  text-align: center;
}

.stop-btn {
  margin-top: 12px;
  width: 100%;
  padding: 10px 14px;
  background-color: #dc3545;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.stop-btn:hover {
  background-color: #b02a37;
}
</style>

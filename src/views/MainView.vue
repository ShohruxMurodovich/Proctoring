<template>
  <div class="container">
    <!-- Fullscreen Modal Component -->
    <FullscreenModal
      v-if="isFaceVerified"
      @fullscreenExit="handleFullscreenExit"
      @tabSwitch="handleTabSwitch"
      @appSwitch="handleAppSwitch"
      @pageLeave="handlePageLeave"
    />

    <!-- Verification Overlay -->
    <div v-if="!isFaceVerified && video" class="verification-overlay">
      <div class="verification-box">
        <h2>Imtixonni Boshlash</h2>
        
        <div v-if="!capturedPhoto">
          <p>Iltimos, imtixonni boshlash uchun yuzingizni tasdiqlang</p>
          <!-- Live Preview inside modal -->
          <div class="live-preview-container">
            <video ref="previewVideo" class="live-preview" autoplay muted playsinline></video>
          </div>
          <button @click="takePhoto" class="verify-btn">Rasmga olish</button>
        </div>

        <div v-else>
          <img :src="capturedPhoto" class="captured-preview" />
          <p v-if="text" style="color: red; margin: 10px 0;">{{ text }}</p>
          <div class="buttons-row">
            <button @click="retakePhoto" class="verify-btn secondary">Qayta olish</button>
            <button 
              @click="confirmVerification" 
              class="verify-btn"
              :disabled="isVerifying"
            >
              {{ isVerifying ? 'Yuborilmoqda...' : 'Yuborish' }}
            </button>
          </div>
        </div>
      </div>
    </div>

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
// =============================================================================
// IMPORTS
// =============================================================================

import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import * as faceapi from 'face-api.js'
import FullscreenModal from '@/components/FullscreenModal.vue'

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/** Structure of exam error definitions from API */
interface ExamError {
  id: number
  name1: string
  name2: string
  name3: string
  name4: string
  long01: string
}

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const API_BASE_URL = 'https://kasbiy-talim.uz/services/platon-core/api'
const RATE_LIMIT_MS = 3000           // Error reporting cooldown (ms)
const HISTORY_LENGTH = 5             // Frames to average for smoothing

// =============================================================================
// ROUTE & EXAM STATE
// =============================================================================

const route = useRoute()
const examId = ref(route.query.exam_id as string || '')

// =============================================================================
// ERROR TRACKING STATE
// =============================================================================

const errorList = ref<ExamError[]>([])
const sessionErrors = ref<any[]>([])
const lastReportedAt = ref<Record<number, number>>({})  // Rate limiting map
const violationCount = ref<number>(0)

// =============================================================================
// UI STATE
// =============================================================================

const isInside = ref<boolean>(false)        // Face within boundary circle
const realUser = ref<boolean>(false)        // Liveness flag
const text = ref<string>("")                // Status message display
const isFaceVerified = ref<boolean>(false)  // Verification complete flag
const isVerifying = ref<boolean>(false)     // Verification in progress

// =============================================================================
// VIDEO ELEMENTS
// =============================================================================

const video = ref<HTMLVideoElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)
const previewVideo = ref<HTMLVideoElement | null>(null)
const capturedPhoto = ref<string | null>(null)

// =============================================================================
// FULLSCREEN STATE
// =============================================================================

const isFullscreenMode = ref<boolean>(false)

// =============================================================================
// MICROPHONE & AUDIO STATE
// =============================================================================

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

// =============================================================================
// FACE DETECTION SMOOTHING
// =============================================================================

const earHistory = ref<number[]>([])    // Eye Aspect Ratio history
const pitchHistory = ref<number[]>([])  // Head pitch history
const turnHistory = ref<number[]>([])   // Head turn history

// =============================================================================
// PHOTO CAPTURE FUNCTIONS
// =============================================================================


const takePhoto = () => {
  const v = previewVideo.value || video.value
  if (!v) return
  
  const canvas = document.createElement('canvas')
  canvas.width = v.videoWidth
  canvas.height = v.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  ctx.drawImage(v, 0, 0)
  capturedPhoto.value = canvas.toDataURL('image/jpeg', 0.8)
}

const retakePhoto = () => {
  capturedPhoto.value = null
  text.value = ''
  setTimeout(attachPreviewStream, 0)
}

// Helper to attach stream to preview video
function attachPreviewStream() {
  if (previewVideo.value && video.value && video.value.srcObject) {
    previewVideo.value.srcObject = video.value.srcObject
  }
}

// =============================================================================
// FACE VERIFICATION
// =============================================================================

const confirmVerification = async () => {
  if (!capturedPhoto.value || !examId.value) return
  
  isVerifying.value = true
  try {
    // Extract raw base64 string (remove data:image/jpeg;base64, prefix)
    const base64Photo = capturedPhoto.value.split(',')[1]
    
    const payload = {
      type: "exam",
      exam_id: examId.value,
      photo: base64Photo
    }
    
    console.log('Sending face verification...', { exam_id: examId.value })
    const res = await fetch(`${API_BASE_URL}/v1/faceId`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    
    const data = await res.json().catch(() => ({}))
    
    // Check nested response structure: { data: { result: true } }
    if (res.ok && data?.data?.result === true) {
      isFaceVerified.value = true
      text.value = ''
      console.log('Face verification successful')
      startMonitoring()
    } else {
      console.error('Face verification failed:', res.status, data)
      text.value = 'Face ID tasdiqlanmadi. Qayta urinib ko\'ring.'
      isVerifying.value = false
    }
  } catch (e) {
    console.error('Face verification exception:', e)
    text.value = 'Xatolik yuz berdi.'
    isVerifying.value = false
  }
}

function startMonitoring() {
  setupMicrophone()
  setupEnhancedMonitoring()
}

// =============================================================================
// API & ERROR HANDLING
// =============================================================================
async function fetchErrorList() {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/exam/errors/list`)
    if (res.ok) {
      const data = await res.json()
      console.log('Error list fetched:', data)
      if (Array.isArray(data)) {
        errorList.value = data
      } else if (data && Array.isArray(data.data)) {
        errorList.value = data.data
      }
    } else {
      console.error('Failed to fetch error list:', res.status)
    }
  } catch (e) {
    console.error('Exception fetching error list:', e)
  }
}

async function sendError(errorId: number) {
  if (!examId.value) return

  // Rate limiting check
  const now = Date.now()
  const lastTime = lastReportedAt.value[errorId] || 0
  if (now - lastTime < RATE_LIMIT_MS) {
    console.log(`Error ${errorId} suppressed (rate limit)`)
    return
  }
  lastReportedAt.value[errorId] = now

  try {
    // Adding to session array first
    const errorEntry = {
      exam_id: examId.value,
      err_id: errorId,
      timestamp: new Date().toISOString()
    }
    sessionErrors.value.push(errorEntry)
    console.log('Violation detected & added to session:', errorEntry)
    console.log('All Session Errors:', sessionErrors.value)

    // Sending to backend
    const url = `${API_BASE_URL}/v1/exam/error?exam_id=${examId.value}&err_id=${errorId}`
    console.log(`Sending error to API: ${url}`)
    const res = await fetch(url, { method: 'PUT' })
    if (!res.ok) {
      console.error('Failed to report error to API:', res.status)
    } else {
      console.log('Error reported successfully')
    }
  } catch (e) {
    console.error('Exception reporting error:', e)
  }
}

// Unified violation reporter
function reportViolation(message: string, errorId: number) {
  // Gate: Do not report violations until face is verified
  if (!isFaceVerified.value) return

  violationCount.value++
  isInside.value = false
  text.value = `${message} (${violationCount.value}-chi marta)`

  if (errorId) {
    sendError(errorId)
  }
}

// =============================================================================
// EYE ASPECT RATIO (EAR) CALCULATION
// =============================================================================

/**
 * Calculates Eye Aspect Ratio for blink detection.
 * Reference: Soukupová and Čech
 */
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

// =============================================================================
// MICROPHONE SETUP & AUDIO MONITORING
// =============================================================================
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
    // Only show error if monitoring started
    if (isFaceVerified.value) {
      text.value = "Mikrofon ruxsati berilmadi!"
    }
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
      reportViolation('Mikrofon: gaplashish aniqlandi', 11)
      lastMicViolationAt = now
    }

    requestAnimationFrame(checkAudioLevel)
  }

  checkAudioLevel()
}

// =============================================================================
// FACE-API INITIALIZATION & DETECTION LOOP
// =============================================================================

/**
 * Initializes face-api models and camera stream.
 * Sets up the main face detection loop.
 */
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
  // await setupMicrophone() // Moved to startMonitoring()
  
  if (video.value) {
    video.value.srcObject = stream
    video.value.addEventListener('play', () => {
      if (!video.value) return
      
      // Attach to preview video if it exists (modal is open)
      attachPreviewStream()

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

    // Violation persistence state
    let violationStartTime = 0
    let currentViolationId: number | null = null

    // Handler to manage persistence
    const handleViolationCandidate = (message: string, errorId: number) => {
      // Check persistence
      if (currentViolationId === errorId) {
        if (violationStartTime > 0 && Date.now() - violationStartTime > 3000) {
           // Persistence threshold reached: Report (which updates UI)
           reportViolation(message, errorId)
        }
      } else {
        // New violation type started
        currentViolationId = errorId
        violationStartTime = Date.now()
        // Do not update UI yet - wait for persistence
      }
    }

    const resetViolationState = () => {
      currentViolationId = null
      violationStartTime = 0
      isInside.value = true
      text.value = ""
    }

    setInterval(async () => {
      if (!video.value || !context) return

      // Gate: Do not detection until face is verified
      if (!isFaceVerified.value) return

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
          handleViolationCandidate("Kameradan uzoqlashing (juda yaqin)", 13)
        }
        else if (distanceFromCamera > 800) {  // 80cm - juda uzoq
          handleViolationCandidate("Kameraga yaqinlashing (juda uzoq)", 14)
        }
        else {
          // Check circular boundary
          // isInside.value = distance < r // Managed by resetViolationState or handleViolationCandidate
          
          if (detections[0]) {
            const landmarks = detections[0].landmarks

             // Check liveness first
            const isAlive = checkLiveness()
            if (!isAlive) return

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
              handleViolationCandidate("Kameraga to'g'ri qarang (Tepaga buring)", 15)
            }
            else if (smoothedPitch < -15) {  // Negative values for looking down
              handleViolationCandidate("Kameraga to'g'ri qarang (Pastga buring)", 16)
            }
            else if (facingStraight) {
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
                // Eyes closed detection
                handleViolationCandidate("Ko'zlarni oching", 19)
                realUser.value = true
              }
              else if (!consistentBlink && isBlinking) {
                // Partial blink / one eye
                handleViolationCandidate("Ko'zlarni to'liq oching", 20)
              }
              else {
                // All good
                resetViolationState()
              }
            }
            else {
              // Turning left/right
              if (smoothedTurn > 0) {
                handleViolationCandidate("Kameraga to'g'ri qarang (O'nga buriling)", 17)
              }
              else {
                handleViolationCandidate("Kameraga to'g'ri qarang (Chapga buriling)", 18)
              }
            }
          }
        }
      } else {
        handleViolationCandidate("Yuz aniqlanmadi...!", 12)
      }
    }, 200)
  })
  }
}

// =============================================================================
// HEAD POSE ESTIMATION
// =============================================================================

/**
 * Estimates head pitch angle from facial landmarks.
 */
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

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Applies weighted smoothing to reduce jitter in detection values.
 */
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

// =============================================================================
// MONITORING EVENT HANDLERS
// =============================================================================
const handleFullscreenExit = () => {
  isFullscreenMode.value = false
  reportViolation("Fullscreen'dan chiqdingiz", 1)
  console.log('Fullscreen exited - violation detected')
}

const handleTabSwitch = () => {
  reportViolation("Boshqa tab'ga o'tdingiz", 2)
  console.log('Tab switch detected - violation')
}

const handleAppSwitch = () => {
  reportViolation("Boshqa ilovaga o'tdingiz", 3)
  console.log('App switch detected - violation')
}

const handlePageLeave = () => {
  reportViolation('Sahifani tark etishga harakat qildingiz', 4)
  console.log('Page leave attempt detected - violation')
}

// =============================================================================
// ENHANCED MONITORING SETUP
// =============================================================================

/**
 * Sets up event listeners for various proctoring violations:
 * - Visibility changes (tab switching)
 * - Focus changes (app switching)
 * - Fullscreen changes
 * - Page navigation attempts
 * - Keyboard shortcuts
 */
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
            event.preventDefault()
            reportViolation('Taqiqlangan tugma kombinatsiyasi', 5)
            break
          case 'w': // Ctrl+W (close tab)
            event.preventDefault()
            reportViolation('Taqiqlangan tugma kombinatsiyasi', 6)
            break
          case 'r': // Ctrl+R (refresh)
            event.preventDefault()
            reportViolation('Taqiqlangan tugma kombinatsiyasi', 7)
            break
          case 'n': // Ctrl+N (new window)
            event.preventDefault()
            reportViolation('Taqiqlangan tugma kombinatsiyasi', 8)
            break
          case 'l': // Ctrl+L (address bar)
            event.preventDefault()
            reportViolation('Taqiqlangan tugma kombinatsiyasi', 9)
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
        reportViolation('Fullscreen tugmasini ishlatish taqiqlangan', 10)
      }
    }
  })
}

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(() => {
  install()
  setupEnhancedMonitoring()
  fetchErrorList()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

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
  width: 100%;
  height: 100%;
  pointer-events: none;
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

.verification-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(15, 23, 42, 0.6); /* Slate 900 with opacity */
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.verification-box {
  background: white;
  padding: 2.5rem;
  border-radius: 32px;
  text-align: center;
  max-width: 420px;
  width: 90%;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  animation: modal-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-pop {
  0% { transform: scale(0.95); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.verification-box h2 {
  margin-bottom: 0.75rem;
  color: #1e293b; /* Slate 800 */
  font-size: 1.5rem;
  font-weight: 700;
}

.verification-box p {
  margin-bottom: 1.5rem;
  color: #64748b; /* Slate 500 */
  line-height: 1.5;
}

.verify-btn {
  background-color: #2563eb; /* Blue 600 */
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 16px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  transition: all 0.2s ease;
  width: 100%;
  box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
}

.verify-btn:hover:not(:disabled) {
  background-color: #1d4ed8; /* Blue 700 */
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(37, 99, 235, 0.3);
}

.verify-btn:active:not(:disabled) {
  transform: translateY(0);
}

.verify-btn:disabled {
  background-color: #94a3b8; /* Slate 400 */
  cursor: not-allowed;
  box-shadow: none;
}

.captured-preview {
  width: 100%;
  max-width: 320px;
  border-radius: 24px;
  margin-bottom: 20px;
  display: block;
  margin-left: auto;
  margin-right: auto;
  /* Transformation to mirror the image if the video is mirrored */
  transform: scaleX(-1);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.buttons-row {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.verify-btn.secondary {
  background-color: #f1f5f9; /* Slate 100 */
  color: #334155; /* Slate 700 */
  box-shadow: none;
}

.verify-btn.secondary:hover {
  background-color: #e2e8f0; /* Slate 200 */
  color: #1e293b; /* Slate 800 */
}

.live-preview-container {
  width: 100%;
  max-width: 320px;
  height: 240px;
  background: #0f172a; /* Slate 900 */
  margin: 0 auto 20px;
  border-radius: 24px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.live-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1); /* Mirror effect */
}

/* Mobile Optimizations */
@media (max-width: 768px) {
  .camera-container {
    width: 280px;
    height: 280px;
  }
  
  .verification-box {
    padding: 1.5rem;
    width: 95%;
    max-width: 360px;
    margin: 0 auto;
  }
  
  .verification-box h2 {
    font-size: 1.25rem;
  }
  
  .live-preview-container {
    height: 200px;
  }
  
  .captured-preview {
    max-height: 200px;
    width: auto;
  }
  
  .verify-btn {
    padding: 10px 20px;
    font-size: 14px;
  }
}
</style>

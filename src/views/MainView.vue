<template>
  <div class="container">
    <!-- Fullscreen Modal Component -->
    <FullscreenModal
      v-if="isFaceVerified"
      @fullscreenExit="handleFullscreenExit"
      @tabSwitch="handleTabSwitch"
      @app-switch="handleAppSwitch"
      @pageLeave="handlePageLeave"
      @started="handleExamStart"
      @fullscreen-restored="handleFullscreenRestored"
    />

    <!-- Exam Iframe -->
    <iframe
      v-if="showExamIframe"
      :src="`https://kasbiy-talim.uz/public/pages/my_examination_proctor?_target=blank&exam_id=${examId}`"
      class="exam-iframe"
      allow="camera *; microphone *; display-capture *; fullscreen *"
    ></iframe>

    <!-- Verification Overlay -->
    
    <div v-if="!isFaceVerified && !isExamFinished && video" class="verification-overlay">
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

    <div 
      v-show="isFaceVerified" 
      class="camera-container" 
      :class="{ 'violation': !isInside, 'safe': isInside }"
    >
      <video ref="video" class="video" autoplay muted playsinline></video>
      <!-- Optional: Canvas overlay if needed for debug, otherwise hide or overlay perfectly -->
      <!-- <div class="overlay"><canvas ref="overlay"></canvas></div> -->
      
      <div class="status-indicator">
        <span v-if="text" class="status-text error">{{ text }}</span>
        <!-- <span v-else class="status-text success">Nazorat ostida</span> -->
      </div>
    </div>
  </div>

</template>

<script lang="ts" setup >

import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import FullscreenModal from '@/components/FullscreenModal.vue'
import { useProctoring } from '@/composables/useProctoring'
import { useMicrophone } from '@/composables/useMicrophone'
import { useFaceDetection } from '@/composables/useFaceDetection'


const route = useRoute()
const examId = ref(route.query.exam_id as string || '')


const {
  isInside, text,
  fetchErrorList, reportViolation, resetViolationState, startExam,
  isExamStarted, finishExam // Destructure needed for timer check
} = useProctoring(examId.value)

const {
  setupMicrophone, stopMicrophone
} = useMicrophone(() => reportViolation('Mikrofon: gaplashish aniqlandi', 11))

const isFaceVerified = ref(false)
const isVerifying = ref(false)
const isExamFinished = ref(false)
const showExamIframe = ref(false) // Controls when iframe actually shows

const {
  video, previewVideo, capturedPhoto,
  initialize: initFaceDetection, takePhoto, retakePhoto
} = useFaceDetection({ reportViolation, resetViolationState }, isFaceVerified)


// Note: This specific logic is kept here as it ties together exam ID, API, and UI state
// specific to the "start exam" flow, which is outside the scope of pure "detection".
const API_BASE_URL = 'https://kasbiy-talim.uz/services/platon-core/api'

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


    const res = await fetch(`${API_BASE_URL}/v1/faceId`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const data = await res.json().catch(() => ({}))

    // Check nested response structure: { data: { result: true } }
    if (res.ok && data?.data === true) {
      isFaceVerified.value = true
      text.value = ''
      await fetchErrorList()
    } else {
      if (res.status === 400 && data?.message) {
        text.value = data.message
      } else {
        console.error('Face verification failed. Response data:', JSON.stringify(data))
        text.value = 'Face ID tasdiqlanmadi. Qayta urinib ko\'ring.'
      }
      isVerifying.value = false
    }
  } catch (e) {
    console.error('Face verification exception:', e)
    text.value = 'Xatolik yuz berdi.'
    isVerifying.value = false
  }
}

const handleExamStart = () => {
  showExamIframe.value = true // Show iframe only when user clicks start button
  setupMicrophone()
  setupEnhancedMonitoring()
  startExam()
}




// Kept in MainView as it handles global window events and UI components
const isFullscreenMode = ref<boolean>(false)
let fullscreenTimer: ReturnType<typeof setInterval> | null = null

const handleFullscreenExit = () => {
  isFullscreenMode.value = false
  // Report immediate violation
  reportViolation('Fullscreen rejimidan chiqildi. Iltimos qaytib kiring!', 1)
  
  // Start recurring penalty
  if (isExamStarted.value) {
    if (fullscreenTimer) clearInterval(fullscreenTimer)
    fullscreenTimer = setInterval(() => {
      reportViolation('Fullscreen rejimiga qayting! (Takroriy jarima)', 1)
    }, 3000)
  }
}

const handleFullscreenRestored = () => {
  isFullscreenMode.value = true
  if (fullscreenTimer) {
    clearInterval(fullscreenTimer)
    fullscreenTimer = null
  }
}

const handleTabSwitch = () => {
  reportViolation("Boshqa tab'ga o'tdingiz", 2)
}

const handleAppSwitch = () => {
  reportViolation("Boshqa ilovaga o'tdingiz", 3)
}

const handlePageLeave = () => {
  reportViolation('Sahifani tark etishga harakat qildingiz', 4)
}

const setupEnhancedMonitoring = () => {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isFullscreenMode.value) {
      handleTabSwitch()
    }
  })

  window.addEventListener('blur', () => {
    if (isFullscreenMode.value) {
      handleAppSwitch()
    }
  })

  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = !!document.fullscreenElement
    isFullscreenMode.value = isFullscreen
    if (!isFullscreen && isFullscreenMode.value) {
      handleFullscreenExit()
    }
  })

  window.addEventListener('beforeunload', (event) => {
    if (isFullscreenMode.value) {
      handlePageLeave()
      event.preventDefault()
      event.returnValue = 'Imtixonni tark etish mumkin emas!'
      return 'Imtixonni tark etish mumkin emas!'
    }
  })

  document.addEventListener('keydown', (event) => {
    if (isFullscreenMode.value) {
      if (event.ctrlKey || event.metaKey) {
        if (['t', 'w', 'r', 'n', 'l'].includes(event.key)) {
          event.preventDefault()
          reportViolation('Taqiqlangan tugma kombinatsiyasi', 5) // Generic ID
        }
        if (event.key === 'Tab' && event.altKey) {
          event.preventDefault()
          handleAppSwitch()
        }
      }
      if (event.key === 'F11') {
        event.preventDefault()
        reportViolation('Fullscreen tugmasini ishlatish taqiqlangan', 10)
      }
    }
  })
}


onMounted(() => {
  initFaceDetection()

  // Listen for exam finished message from iframe
  window.addEventListener('message', (event) => {
    // Security check: ensure the message is what we expect
    // You might want to check event.origin here if known
    if (event.data && event.data.type === 'EXAM_FINISHED') {
      
      // Stop media resources
      if (video.value?.srcObject) {
         const stream = video.value.srcObject as MediaStream;
         stream.getTracks().forEach(track => track.stop());
         video.value.srcObject = null;
      }
      stopMicrophone()
      isFaceVerified.value = false 
      isExamFinished.value = true // Prevent verification overlay from showing
      
      // Submit report
      finishExam() 
    }
  })
})

onUnmounted(() => {
  stopMicrophone()
  // Note: Anonymous event listeners can't be removed easily unless stored in a variable, 
  // but since the component is unmounting, it's often acceptable in simple cases. 
  // For correctness, let's extract the handler if strictly needed, but for now this is fine 
  // as the page context is likely destroyed or navigated away from.
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.container {
  width: 100vw;
  height: 100vh;
  display: flex;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.exam-iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  z-index: 1;
}

.camera-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 200px;
  height: 200px;
  z-index: 1000;
  background: white;
  border-radius: 50%;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
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

.camera-container {
  position: fixed;
  bottom: 32px;
  right: 32px;
  width: 180px;
  height: 180px;
  z-index: 1000;
  background: #000;
  border-radius: 50%;
  box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 4px solid transparent;
}

.camera-container.safe {
  border-color: #22c55e; /* Green 500 */
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.2), 0 10px 30px -10px rgba(0, 0, 0, 0.5);
}

.camera-container.violation {
  border-color: #ef4444; /* Red 500 */
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2), 0 10px 30px -10px rgba(0, 0, 0, 0.5);
  animation: pulse-red 2s infinite;
}

@keyframes pulse-red {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  transform: scaleX(-1);
  display: block;
}

.status-indicator {
  position: absolute;
  bottom: -40px; /* Position below circle */
  left: 50%;
  transform: translateX(-50%);
  width: 240px; /* Wider area for text */
  text-align: center;
  pointer-events: none;
}

.status-text {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: white;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  transition: all 0.3s ease;
}

.status-text.error {
  background-color: rgba(239, 68, 68, 0.9);
  border: 1px solid #ef4444;
}

.status-text.success {
  background-color: rgba(34, 197, 94, 0.9);
  border: 1px solid #22c55e;
}

/* Remove old overlay/inside/outside styles */
.overlay { display: none; }
.inside, .outside { display: none; }

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

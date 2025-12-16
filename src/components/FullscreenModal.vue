<template>
  <div v-if="showModal" class="modal-overlay">
    <div class="modal-content">
      <h2>Imtixonni Boshlash</h2>
      <p>Imtixonni boshlash uchun kamera va mikrofon ruxsatlarini bering</p>

      <!-- Permission Status Indicators -->
      <div class="permission-status">
        <div class="permission-item" :class="{ 'granted': cameraPermission, 'denied': !cameraPermission }">
          <span class="permission-icon">📹</span>
          <span class="permission-text">
            {{ cameraPermission ? 'Kamera ruxsati berildi' : 'Kamera ruxsati kerak' }}
          </span>
          <span class="status-indicator">{{ cameraPermission ? '✓' : '✗' }}</span>
        </div>

        <div class="permission-item" :class="{ 'granted': microphonePermission, 'denied': !microphonePermission }">
          <span class="permission-icon">🎤</span>
          <span class="permission-text">
            {{ microphonePermission ? 'Mikrofon ruxsati berildi' : 'Mikrofon ruxsati kerak' }}
          </span>
          <span class="status-indicator">{{ microphonePermission ? '✓' : '✗' }}</span>
        </div>

        <div class="permission-item" :class="{ 'granted': screenPermission, 'denied': !screenPermission }">
          <span class="permission-icon">🖥️</span>
          <span class="permission-text">
            {{ screenPermission ? 'Ekran yozuviga ruxsat berildi' : 'Ekran yozuviga ruxsat kerak' }}
          </span>
          <span class="status-indicator">{{ screenPermission ? '✓' : '✗' }}</span>
        </div>
      </div>

      <div class="warning-text">
        <p>⚠️ Imtixon davomida boshqa sahifalar, ilovalar yoki odamlar bilan gaplashish taqiqlangan!</p>
        <p>📋 Kamera va mikrofon faqat imtixon nazorati uchun ishlatiladi</p>
      </div>

      <button
        @click="handleButtonClick"
        class="fullscreen-btn"
        :disabled="isRequesting"
      >
        <span v-if="isRequesting">Barcha ruxsatlar so'ralmoqda...</span>
        <span v-else-if="allPermissionsGranted">Imtixonni Boshlash</span>
        <span v-else>BARCHA RUXSATLARNI BERISH</span>
      </button>

      <div v-if="errorMessage" class="error-message">
        <p>{{ errorMessage }}</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'

const showModal = ref(true)

// Define emits
const emit = defineEmits<{
  fullscreenExit: []
  tabSwitch: []
  appSwitch: []
  pageLeave: []
  screenRecordingStarted: [MediaStream]
}>()

// Track if user has entered fullscreen at least once
const hasEnteredFullscreen = ref(false)

// Permission states
const cameraPermission = ref(false)
const microphonePermission = ref(false)
const screenPermission = ref(false)
const isRequesting = ref(false)
const errorMessage = ref('')

const allPermissionsGranted = computed(() => {
  return cameraPermission.value && microphonePermission.value && screenPermission.value
})

const handleButtonClick = () => {
  if (allPermissionsGranted.value) {
    enterFullscreen()
  } else {
    requestAllPermissions()
  }
}


const enterFullscreen = async () => {
  if (!cameraPermission.value || !microphonePermission.value || !screenPermission.value) {
    errorMessage.value = 'Avval kamera, mikrofon va ekran yozuvi ruxsatlarini bering!'
    return
  }

  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen()
    } else if ((document.documentElement as unknown as Element & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
      await (document.documentElement as unknown as Element & { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen()
    } else if ((document.documentElement as unknown as Element & { msRequestFullscreen?: () => Promise<void> }).msRequestFullscreen) {
      await (document.documentElement as unknown as Element & { msRequestFullscreen: () => Promise<void> }).msRequestFullscreen()
    }
    hasEnteredFullscreen.value = true
    showModal.value = false
  } catch (error) {
    console.error('Fullscreen request failed:', error)
    errorMessage.value = 'Fullscreen rejimiga o\'tishda xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.'
  }
}



// Request all (camera, microphone, screen) in one flow
const requestAllPermissions = async () => {
  isRequesting.value = true
  errorMessage.value = ''
  try {
    // 1) Camera + Microphone
    const avStream = await navigator.mediaDevices.getUserMedia({
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
    const videoTracks = avStream.getVideoTracks()
    const audioTracks = avStream.getAudioTracks()
    cameraPermission.value = videoTracks.length > 0
    microphonePermission.value = audioTracks.length > 0
    // We only needed permissions; stop tracks to free devices
    avStream.getTracks().forEach(t => t.stop())

    // 2) Screen capture (with system audio when available)
    const mediaDevices = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream> }
    const getDisplay = mediaDevices.getDisplayMedia ? mediaDevices.getDisplayMedia.bind(mediaDevices) : (navigator as unknown as { getDisplayMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream> }).getDisplayMedia
    const displayStream = await getDisplay({ video: true, audio: true })
    screenPermission.value = true
    emit('screenRecordingStarted', displayStream)

    if (!cameraPermission.value || !microphonePermission.value || !screenPermission.value) {
      errorMessage.value = 'Iltimos, barcha ruxsatlarni bering (kamera, mikrofon, ekran).'
    }
  } catch (err) {
    console.error('All permission request failed:', err)
    if (!cameraPermission.value || !microphonePermission.value) {
      errorMessage.value = 'Kamera/mikrofon ruxsati berilmadi. Brauzer sozlamalarini tekshiring.'
    } else {
      errorMessage.value = 'Ekran yozuviga ruxsat berilmadi. Qayta urinib ko\'ring.'
    }
  } finally {
    isRequesting.value = false
  }
}

// Monitor fullscreen changes
const handleFullscreenChange = () => {
  const isFullscreen = !!(
    document.fullscreenElement ||
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
    (document as Document & { msFullscreenElement?: Element }).msFullscreenElement
  )

  if (!isFullscreen && hasEnteredFullscreen.value && !showModal.value) {
    // User exited fullscreen after entering it
    console.log('User exited fullscreen')
    showModal.value = true
    emit('fullscreenExit')
  }
}

// Monitor visibility changes (tab switching, minimizing)
const handleVisibilityChange = () => {
  if (document.hidden && hasEnteredFullscreen.value) {
    console.log('User switched to another tab or minimized the window')
    emit('tabSwitch')
  }
}

// Monitor focus changes (application switching)
let focusTimeout: NodeJS.Timeout | null = null

const handleFocusChange = () => {
  if (!document.hasFocus() && hasEnteredFullscreen.value) {
    // Clear any existing timeout
    if (focusTimeout) {
      clearTimeout(focusTimeout)
    }

    // Add a small delay to prevent false positives from quick focus changes
    focusTimeout = setTimeout(() => {
      if (!document.hasFocus() && hasEnteredFullscreen.value) {
        console.log('User switched to another application')
        emit('appSwitch')
      }
    }, 500) // 500ms delay to ensure it's a real app switch
  } else {
    // Clear timeout if focus is regained quickly
    if (focusTimeout) {
      clearTimeout(focusTimeout)
      focusTimeout = null
    }
  }
}

// Monitor page unload (navigation away)
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (hasEnteredFullscreen.value) {
    event.preventDefault()
    event.returnValue = 'Imtixonni tark etish mumkin emas!'
    emit('pageLeave')
    return 'Imtixonni tark etish mumkin emas!'
  }
}

onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.addEventListener('msfullscreenchange', handleFullscreenChange)

  document.addEventListener('visibilitychange', handleVisibilityChange)

  window.addEventListener('focus', handleFocusChange)
  window.addEventListener('blur', handleFocusChange)

  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.removeEventListener('msfullscreenchange', handleFullscreenChange)

  document.removeEventListener('visibilitychange', handleVisibilityChange)

  window.removeEventListener('focus', handleFocusChange)
  window.removeEventListener('blur', handleFocusChange)

  window.removeEventListener('beforeunload', handleBeforeUnload)

  // Clear focus timeout
  if (focusTimeout) {
    clearTimeout(focusTimeout)
  }
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.modal-overlay {
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
  z-index: 1000;
  font-family: 'Inter', sans-serif;
}

.modal-content {
  background: white;
  padding: 2.5rem;
  border-radius: 32px;
  text-align: center;
  max-width: 440px;
  width: 90%;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  animation: modal-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-pop {
  0% { transform: scale(0.95); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.modal-content h2 {
  margin-bottom: 0.75rem;
  color: #1e293b; /* Slate 800 */
  font-size: 1.5rem;
  font-weight: 700;
}

.modal-content p {
  margin-bottom: 1.5rem;
  color: #64748b; /* Slate 500 */
  line-height: 1.5;
}

.fullscreen-btn {
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

.fullscreen-btn:hover {
  background-color: #1d4ed8; /* Blue 700 */
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(37, 99, 235, 0.3);
}

.fullscreen-btn:active {
  transform: translateY(0);
}

.warning-text {
  background-color: #fffbeb; /* Amber 50 */
  border: 1px solid #fcd34d; /* Amber 300 */
  border-radius: 16px;
  padding: 16px;
  margin: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warning-text p {
  margin: 0;
  color: #b45309; /* Amber 700 */
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  line-height: 1.4;
}

.permission-status {
  margin: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.permission-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid #e2e8f0; /* Slate 200 */
  transition: all 0.3s ease;
  background-color: #f8fafc; /* Slate 50 */
}

.permission-item.granted {
  background-color: #ecfdf5; /* Emerald 50 */
  border-color: #34d399; /* Emerald 400 */
  color: #065f46; /* Emerald 800 */
}

.permission-item.denied {
  background-color: #fef2f2; /* Red 50 */
  border-color: #f87171; /* Red 400 */
  color: #991b1b; /* Red 800 */
}

.permission-icon {
  font-size: 20px;
  margin-right: 12px;
}

.permission-text {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  text-align: left;
}

.status-indicator {
  font-size: 18px;
  font-weight: bold;
}

.permission-btn {
  background-color: #0ea5e9; /* Sky 500 */
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 16px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  transition: all 0.2s ease;
  margin-bottom: 12px;
  width: 100%;
  box-shadow: 0 4px 6px -1px rgba(14, 165, 233, 0.2);
}

.permission-btn:hover:not(:disabled) {
  background-color: #0284c7; /* Sky 600 */
  transform: translateY(-1px);
}

.permission-btn:disabled {
  background-color: #94a3b8; /* Slate 400 */
  cursor: not-allowed;
  box-shadow: none;
}

.error-message {
  background-color: #fee2e2; /* Red 100 */
  border: 1px solid #fca5a5; /* Red 300 */
  border-radius: 16px;
  padding: 12px;
  margin-top: 16px;
}

.error-message p {
  margin: 0;
  color: #b91c1c; /* Red 700 */
  font-size: 14px;
  font-weight: 500;
}

/* Mobile Optimizations */
@media (max-width: 768px) {
  .modal-content {
    padding: 1.5rem;
    width: 95%;
    max-width: 360px;
    border-radius: 24px;
  }
  
  .modal-content h2 {
    font-size: 1.25rem;
  }
  
  .permission-status {
    gap: 8px;
  }
  
  .permission-item {
    padding: 10px 12px;
  }
  
  .permission-text {
    font-size: 13px;
  }
  
  .permission-icon {
    font-size: 18px;
    margin-right: 8px;
  }
  
  .fullscreen-btn {
    padding: 12px 16px;
    font-size: 14px;
  }
  
  .warning-text {
    padding: 12px;
  }
  
  .warning-text p {
    font-size: 13px;
  }
}
</style>

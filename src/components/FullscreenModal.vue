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
        @click="requestAllPermissions"
        class="permission-btn"
        :disabled="isRequesting"
      >
        {{ isRequesting ? 'Barcha ruxsatlar so\'ralmoqda...' : 'BARCHA RUXSATLARNI BERISH' }}
      </button>

      <button
        @click="enterFullscreen"
        class="fullscreen-btn"
        :disabled="!cameraPermission || !microphonePermission || !screenPermission"
        v-if="cameraPermission && microphonePermission && screenPermission"
      >
        Imtixonni Boshlash
      </button>

      <div v-if="errorMessage" class="error-message">
        <p>{{ errorMessage }}</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'

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
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 10px;
  text-align: center;
  max-width: 400px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.modal-content h2 {
  margin-bottom: 1rem;
  color: #333;
}

.modal-content p {
  margin-bottom: 2rem;
  color: #666;
}

.fullscreen-btn {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  transition: background-color 0.3s;
}

.fullscreen-btn:hover {
  background-color: #0056b3;
}

.warning-text {
  background-color: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 5px;
  padding: 10px;
  margin: 1rem 0;
}

.warning-text p {
  margin: 5px 0;
  color: #856404;
  font-size: 14px;
  font-weight: 500;
}

.permission-status {
  margin: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.permission-item {
  display: flex;
  align-items: center;
  padding: 10px;
  border-radius: 8px;
  border: 2px solid #ddd;
  transition: all 0.3s ease;
}

.permission-item.granted {
  background-color: #d4edda;
  border-color: #28a745;
  color: #155724;
}

.permission-item.denied {
  background-color: #f8d7da;
  border-color: #dc3545;
  color: #721c24;
}

.permission-icon {
  font-size: 20px;
  margin-right: 10px;
}

.permission-text {
  flex: 1;
  font-weight: 500;
}

.status-indicator {
  font-size: 18px;
  font-weight: bold;
}

.permission-btn {
  background-color: #17a2b8;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  transition: background-color 0.3s;
  margin-bottom: 10px;
  width: 100%;
}

.permission-btn:hover:not(:disabled) {
  background-color: #138496;
}

.permission-btn:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.error-message {
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 5px;
  padding: 10px;
  margin-top: 10px;
}

.error-message p {
  margin: 0;
  color: #721c24;
  font-size: 14px;
}
</style>

<template>
  <div class="container">
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

const video = ref<any>(null)
const overlay = ref<any>(null)
const isInside = ref<any>(false)
const realUser = ref<any>(false)
const text = ref<any>("")
function getEAR(eye:any) {
  const p2p6 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y)
  const p3p5 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y)
  const p1p4 = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y)
  return (p2p6 + p3p5) / (2.0 * p1p4)
}


async function install() {
  await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
  await faceapi.nets.faceLandmark68Net.loadFromUri('/models')
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 500 },
      height: { ideal: 500 },
      facingMode: 'user'
    }
  })
  video.value.srcObject = stream
  video.value.addEventListener('play', () => {
    const canvas:any = faceapi.createCanvasFromMedia(video.value)
    canvas.strokeStyle = 'red'
    overlay.value.replaceWith(canvas)
    overlay.value = canvas
    const context = canvas.getContext('2d')

    const displaySize = {
      width: video.value.videoWidth,
      height: video.value.videoHeight
    }

    canvas.width = displaySize.width
    canvas.height = displaySize.height

    faceapi.matchDimensions(canvas, displaySize)

    setInterval(async () => {
      const detections = await faceapi.detectAllFaces(video.value, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks()
      const resized = faceapi.resizeResults(detections, displaySize)
      context.clearRect(0, 0, canvas.width, canvas.height)
      // Dumaloq markaz va radius
      const cx = displaySize.width / 2
      const cy = displaySize.height / 2
      const r = 148
      // Dumaloqni chizish
      context.beginPath()
      context.arc(cx, cy, r, 0, 2 * Math.PI)
      context.strokeStyle = isInside.value ? 'green' : 'red'
      context.lineWidth = 4
      context.stroke()

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
        console.log("distanceFromCamera", distanceFromCamera)
        if (distanceFromCamera < 150) {
          text.value = "Kameradan uzoqlashing"
          isInside.value = false
        }
        else if (distanceFromCamera > 240) {
          text.value = "Kameraga yaqinlashing"
          isInside.value = false
        }
        else {
          isInside.value = distance < r
          text.value = ""
          if (detections[0]) {
            const landmarks = detections[0].landmarks
            const leftEye = landmarks.getLeftEye()
            const rightEye = landmarks.getRightEye()
            const nose = landmarks.getNose()

            const eyeCenterX = (leftEye[0].x + rightEye[3].x) / 2
            const noseX = nose[3].x
            const offsetX = noseX - eyeCenterX

            const HEAD_TURN_THRESHOLD = 10
            const facingStraight = Math.abs(offsetX) < HEAD_TURN_THRESHOLD
            console.log("offsetX", offsetX)
            const pinch = estimatePitch(landmarks)
            console.log("pinch", pinch)
            if (pinch > 20) {
              isInside.value = false
              text.value = "Kameraga to'g'ri qarang (Tepaga buring)"
            }
            else if (pinch < 10) {
              isInside.value = false
              text.value = "Kameraga to'g'ri qarang (Pastga buring)"
            }
            else if (facingStraight) {
              isInside.value = true
              text.value = ""
              const leftEAR = getEAR(leftEye)
              const rightEAR = getEAR(rightEye)
              const avgEAR = (leftEAR + rightEAR) / 2
              const BLINK_THRESHOLD = 0.25
              const isBlinking = avgEAR < BLINK_THRESHOLD
              console.log("avgEAR", avgEAR)
              if (isBlinking) {
                isInside.value = false
                realUser.value = true
                text.value = "Ko'zlarni oching"
              }
              else {
                isInside.value = true
                text.value = ""
              }
            }
            else {
              isInside.value = false
              if (offsetX > 0) {
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


function estimatePitch(landmarks:any) {
  const nose = landmarks.getNose()
  const jaw = landmarks.getJawOutline()
  const leftEye = landmarks.getLeftEye()
  const rightEye = landmarks.getRightEye()

  // Burun uchining y koordinatasi (3-chi nuqta eng o'rtada joylashgan)
  const noseTipY = nose[3].y

  // Ikki ko'z markazi
  const eyeAvgY = (leftEye[1].y + rightEye[1].y) / 2

  // Iyakka yaqin nuqta (jaw outline'ning o'rta qismi)
  const chinY = jaw[8].y

  // Yuqoriga/pastga qarash burchagini taxmin qilish
  const faceHeight = chinY - eyeAvgY
  const noseOffset = noseTipY - eyeAvgY

  // Pitchni gradusda taxmin qilish (proporsional o'lchov)
  const pitchRatio = noseOffset / faceHeight
  const pitchDegrees = pitchRatio * 40  // max taxminiy 40° pastga/tepaga

  return pitchDegrees
}


function calculateDistanceFromSize(faceArea:any) { 
  const referenceArea = 10000 
  const referenceDistance = 500
  const distance = referenceDistance * Math.sqrt(referenceArea / faceArea)
  return distance
}

onMounted(() => {
  install()
 
})
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
</style>

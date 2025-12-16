/**
 * Face Detection Composable
 * 
 * Handles face detection using face-api.js, including:
 * - Model loading
 * - Camera stream setup
 * - Face landmark detection
 * - Eye/head position analysis
 * - Violation candidate handling with persistence
 */

import { ref } from 'vue'
import * as faceapi from 'face-api.js'
import {
    BLINK_THRESHOLD,
    CONSISTENT_BLINK_THRESHOLD,
    HEAD_TURN_THRESHOLD,
    PITCH_THRESHOLD,
    SMOOTHING_HISTORY_LENGTH,
    MIN_CAMERA_DISTANCE_MM,
    MAX_CAMERA_DISTANCE_MM,
    REFERENCE_FACE_AREA,
    REFERENCE_DISTANCE_MM,
    CIRCLE_BOUNDARY_RADIUS,
    FACE_DETECTION_INTERVAL_MS,
    VIOLATION_PERSISTENCE_MS,
    AUTO_PHOTO_INTERVAL_MS
} from '@/constants'

// =============================================================================
// Types
// =============================================================================

export interface ViolationHandler {
    reportViolation: (message: string, errorId: number) => void
    resetViolationState: () => void
}

// =============================================================================
// Composable
// =============================================================================

export function useFaceDetection(
    violationHandler: ViolationHandler,
    isFaceVerified: { value: boolean }
) {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    const video = ref<HTMLVideoElement | null>(null)
    const overlay = ref<HTMLCanvasElement | null>(null)
    const previewVideo = ref<HTMLVideoElement | null>(null)
    const capturedPhoto = ref<string | null>(null)
    const realUser = ref(false)

    // Smoothing histories
    const earHistory = ref<number[]>([])
    const pitchHistory = ref<number[]>([])
    const turnHistory = ref<number[]>([])

    // Violation persistence state
    let violationStartTime = 0
    let currentViolationId: number | null = null
    let photoInterval: number | null = null

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    /**
     * Calculates Eye Aspect Ratio (EAR) for blink detection.
     * Reference: Soukupová and Čech
     */
    function getEAR(eye: faceapi.Point[]): number {
        if (!eye || eye.length < 6) return 1
        const p2p6 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y)
        const p3p5 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y)
        const p1p4 = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y)
        if (p1p4 === 0) return 1
        return (p2p6 + p3p5) / (2.0 * p1p4)
    }

    /**
     * Estimates head pitch angle from landmarks.
     */
    function estimatePitch(landmarks: faceapi.FaceLandmarks68): number {
        const nose = landmarks.getNose()
        const jaw = landmarks.getJawOutline()
        const leftEye = landmarks.getLeftEye()
        const rightEye = landmarks.getRightEye()

        const leftEyeCenter = {
            x: leftEye.reduce((sum, p) => sum + p.x, 0) / leftEye.length,
            y: leftEye.reduce((sum, p) => sum + p.y, 0) / leftEye.length
        }
        const rightEyeCenter = {
            x: rightEye.reduce((sum, p) => sum + p.x, 0) / rightEye.length,
            y: rightEye.reduce((sum, p) => sum + p.y, 0) / rightEye.length
        }

        const eyeCenterY = (leftEyeCenter.y + rightEyeCenter.y) / 2
        const noseTip = nose[3]
        const chinPoint = jaw[8]

        const faceHeight = chinPoint.y - eyeCenterY
        const noseOffset = noseTip.y - eyeCenterY
        const normalizedOffset = noseOffset / faceHeight
        const pitchDegrees = normalizedOffset * 60

        const noseBridge = nose[1]
        const bridgeOffset = noseBridge.y - eyeCenterY
        const normalizedBridgeOffset = bridgeOffset / faceHeight
        const bridgePitch = normalizedBridgeOffset * 60

        return (pitchDegrees + bridgePitch) / 2
    }

    /**
     * Applies weighted smoothing to reduce jitter.
     */
    function smoothValue(history: number[], newValue: number): number {
        history.push(newValue)
        if (history.length > SMOOTHING_HISTORY_LENGTH) {
            history.shift()
        }

        let weightedSum = 0
        let totalWeight = 0
        for (let i = 0; i < history.length; i++) {
            const weight = i + 1
            weightedSum += history[i] * weight
            totalWeight += weight
        }
        return weightedSum / totalWeight
    }

    /**
     * Calculates approximate distance from camera based on face size.
     */
    function calculateDistanceFromSize(faceArea: number): number {
        return REFERENCE_DISTANCE_MM * Math.sqrt(REFERENCE_FACE_AREA / faceArea)
    }

    // -------------------------------------------------------------------------
    // Violation Handling
    // -------------------------------------------------------------------------

    /**
     * Handles a violation candidate - only reports after persistence threshold.
     */
    function handleViolationCandidate(message: string, errorId: number): void {
        if (currentViolationId === errorId) {
            if (violationStartTime > 0 && Date.now() - violationStartTime > VIOLATION_PERSISTENCE_MS) {
                violationHandler.reportViolation(message, errorId)
            }
        } else {
            currentViolationId = errorId
            violationStartTime = Date.now()
        }
    }

    /**
     * Resets the violation tracking state.
     */
    function resetViolationTracking(): void {
        currentViolationId = null
        violationStartTime = 0
        violationHandler.resetViolationState()
    }

    // -------------------------------------------------------------------------
    // Photo Capture
    // -------------------------------------------------------------------------

    /**
     * Captures a photo from the video stream.
     */
    function takePhoto(): void {
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

    /**
     * Clears captured photo for retake.
     */
    function retakePhoto(): void {
        capturedPhoto.value = null
        setTimeout(attachPreviewStream, 0)
    }

    /**
     * Attaches video stream to preview element.
     */
    function attachPreviewStream(): void {
        if (previewVideo.value && video.value && video.value.srcObject) {
            previewVideo.value.srcObject = video.value.srcObject
        }
    }

    // -------------------------------------------------------------------------
    // Core Detection
    // -------------------------------------------------------------------------

    /**
     * Main detection loop - analyzes face position and triggers violations.
     */
    function runDetectionLoop(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, displaySize: { width: number, height: number }): void {
        const circleCenterX = displaySize.width / 2
        const circleCenterY = displaySize.height / 2

        setInterval(async () => {
            if (!video.value || !context) return
            if (!isFaceVerified.value) return

            const detections = await faceapi
                .detectAllFaces(video.value, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()

            const resized = faceapi.resizeResults(detections, displaySize)
            context.clearRect(0, 0, canvas.width, canvas.height)

            // Draw circle boundary
            context.beginPath()
            context.arc(circleCenterX, circleCenterY, CIRCLE_BOUNDARY_RADIUS, 0, 2 * Math.PI)
            context.strokeStyle = 'green'  // Will be updated based on violations
            context.lineWidth = 4
            context.stroke()

            if (resized.length > 0) {
                analyzeDetection(resized[0], circleCenterX, circleCenterY)
            } else {
                handleViolationCandidate("Yuz aniqlanmadi...!", 12)
            }
        }, FACE_DETECTION_INTERVAL_MS)
    }

    /**
     * Analyzes a single face detection for violations.
     */
    function analyzeDetection(
        detection: faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>,
        circleCenterX: number,
        circleCenterY: number
    ): void {
        const { x, y, width, height } = detection.detection.box
        const faceArea = width * height
        const distanceFromCamera = calculateDistanceFromSize(faceArea)

        // Distance checks
        if (distanceFromCamera < MIN_CAMERA_DISTANCE_MM) {
            handleViolationCandidate("Kameradan uzoqlashing (juda yaqin)", 13)
            return
        }
        if (distanceFromCamera > MAX_CAMERA_DISTANCE_MM) {
            handleViolationCandidate("Kameraga yaqinlashing (juda uzoq)", 14)
            return
        }

        const landmarks = detection.landmarks
        const leftEye = landmarks.getLeftEye()
        const rightEye = landmarks.getRightEye()
        const nose = landmarks.getNose()

        // Calculate head orientation
        const leftEyeCenter = {
            x: leftEye.reduce((sum, p) => sum + p.x, 0) / leftEye.length,
            y: leftEye.reduce((sum, p) => sum + p.y, 0) / leftEye.length
        }
        const rightEyeCenter = {
            x: rightEye.reduce((sum, p) => sum + p.x, 0) / rightEye.length,
            y: rightEye.reduce((sum, p) => sum + p.y, 0) / rightEye.length
        }

        const noseTip = nose[3]
        const eyeCenterX = (leftEyeCenter.x + rightEyeCenter.x) / 2
        const offsetX = noseTip.x - eyeCenterX
        const eyeDistance = Math.hypot(rightEyeCenter.x - leftEyeCenter.x, rightEyeCenter.y - leftEyeCenter.y)
        const normalizedOffset = offsetX / eyeDistance

        const smoothedTurn = smoothValue(turnHistory.value, normalizedOffset)
        const smoothedPitch = smoothValue(pitchHistory.value, estimatePitch(landmarks))
        const facingStraight = Math.abs(smoothedTurn) < HEAD_TURN_THRESHOLD

        // Pitch checks
        if (smoothedPitch > PITCH_THRESHOLD) {
            handleViolationCandidate("Kameraga to'g'ri qarang (Tepaga buring)", 15)
            return
        }
        if (smoothedPitch < -PITCH_THRESHOLD) {
            handleViolationCandidate("Kameraga to'g'ri qarang (Pastga buring)", 16)
            return
        }

        // Turn checks
        if (!facingStraight) {
            if (smoothedTurn > 0) {
                handleViolationCandidate("Kameraga to'g'ri qarang (O'nga buriling)", 17)
            } else {
                handleViolationCandidate("Kameraga to'g'ri qarang (Chapga buriling)", 18)
            }
            return
        }

        // Eye checks
        const leftEAR = getEAR(leftEye)
        const rightEAR = getEAR(rightEye)
        const avgEAR = (leftEAR + rightEAR) / 2
        const smoothedEAR = smoothValue(earHistory.value, avgEAR)
        const isBlinking = smoothedEAR < BLINK_THRESHOLD
        const earDifference = Math.abs(leftEAR - rightEAR)
        const consistentBlink = earDifference < CONSISTENT_BLINK_THRESHOLD

        if (isBlinking && consistentBlink) {
            handleViolationCandidate("Ko'zlarni oching", 19)
            realUser.value = true
            return
        }
        if (!consistentBlink && isBlinking) {
            handleViolationCandidate("Ko'zlarni to'liq oching", 20)
            return
        }

        // All good
        resetViolationTracking()
    }

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /**
     * Loads face-api models and initializes camera.
     */
    async function initialize(): Promise<void> {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        await faceapi.nets.faceLandmark68Net.loadFromUri('/models')

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

        if (video.value) {
            video.value.srcObject = stream
            video.value.addEventListener('play', onVideoPlay)
        }
    }

    /**
     * Handler for video play event - sets up detection loop.
     */
    function onVideoPlay(): void {
        if (!video.value) return

        // Start auto photo uploads
        if (!photoInterval) {
            photoInterval = window.setInterval(() => {
                // Photo upload logic would go here
            }, AUTO_PHOTO_INTERVAL_MS)
        }

        attachPreviewStream()

        const canvas = faceapi.createCanvasFromMedia(video.value)
        const context = canvas.getContext('2d')
        if (!context) return

        context.strokeStyle = 'red'

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

        runDetectionLoop(canvas, context, displaySize)
    }

    // -------------------------------------------------------------------------
    // Return
    // -------------------------------------------------------------------------

    return {
        // Refs (for template binding)
        video,
        overlay,
        previewVideo,
        capturedPhoto,
        realUser,

        // Methods
        initialize,
        takePhoto,
        retakePhoto,
        attachPreviewStream
    }
}

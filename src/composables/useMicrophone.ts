/**
 * Microphone Composable
 * 
 * Handles microphone access, audio monitoring, and speech detection
 * with adaptive noise floor calibration.
 */

import { ref } from 'vue'
import {
    AUDIO_CALIBRATION_FRAMES,
    ATTACK_THRESHOLD_MULTIPLIER,
    RELEASE_THRESHOLD_MULTIPLIER,
    ATTACK_FRAME_COUNT,
    RELEASE_FRAME_COUNT,
    MIC_VIOLATION_COOLDOWN_MS
} from '@/constants'

// =============================================================================
// Composable
// =============================================================================

export function useMicrophone(onSpeakingViolation: () => void) {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    const audioStream = ref<MediaStream | null>(null)
    const audioContext = ref<AudioContext | null>(null)
    const analyser = ref<AnalyserNode | null>(null)
    const microphone = ref<MediaStreamAudioSourceNode | null>(null)
    const bandpass = ref<BiquadFilterNode | null>(null)

    const isMicrophoneActive = ref(false)
    const audioLevel = ref(0)
    const isSpeaking = ref(false)
    const noiseFloor = ref(0)
    const rmsLevel = ref(0)
    const calibrating = ref(true)

    // Internal tracking
    let calibrationValues: number[] = []
    let lastMicViolationAt = 0
    let attackFrames = 0
    let releaseFrames = 0

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    /**
     * Initializes microphone access and audio monitoring.
     */
    async function setupMicrophone(): Promise<void> {
        try {
            audioStream.value = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            })

            // Create audio context
            audioContext.value = new (window.AudioContext || (window as any).webkitAudioContext)()
            analyser.value = audioContext.value.createAnalyser()
            microphone.value = audioContext.value.createMediaStreamSource(audioStream.value)
            bandpass.value = audioContext.value.createBiquadFilter()

            // Configure bandpass filter for speech frequencies
            bandpass.value.type = 'bandpass'
            bandpass.value.frequency.value = 1200 // Center in speech band
            bandpass.value.Q.value = 0.8

            // Configure analyser
            analyser.value.fftSize = 1024
            analyser.value.smoothingTimeConstant = 0.7

            // Connect: mic -> bandpass -> analyser
            microphone.value.connect(bandpass.value)
            bandpass.value.connect(analyser.value)

            isMicrophoneActive.value = true
            startAudioMonitoring()
        } catch (error) {
            console.error('Microphone access denied:', error)
            isMicrophoneActive.value = false
        }
    }

    // -------------------------------------------------------------------------
    // Audio Monitoring
    // -------------------------------------------------------------------------

    /**
     * Starts the audio level monitoring loop.
     */
    function startAudioMonitoring(): void {
        if (!analyser.value) return

        const freqLen = analyser.value.frequencyBinCount
        const freqData = new Uint8Array(freqLen)
        const timeLen = analyser.value.fftSize
        const timeData = new Uint8Array(timeLen)

        function checkAudioLevel() {
            if (!analyser.value) return

            // Get time-domain data for RMS calculation
            analyser.value.getByteTimeDomainData(timeData)
            let sumSquares = 0
            for (let i = 0; i < timeLen; i++) {
                const v = (timeData[i] - 128) / 128 // Normalize to -1..1
                sumSquares += v * v
            }
            const rms = Math.sqrt(sumSquares / timeLen)
            rmsLevel.value = rms

            // Also calculate frequency average for UI/debug
            analyser.value.getByteFrequencyData(freqData)
            let sum = 0
            for (let i = 0; i < freqLen; i++) sum += freqData[i]
            audioLevel.value = sum / freqLen

            // Calibration phase (first ~1.5s)
            if (calibrating.value) {
                calibrationValues.push(rms)
                if (calibrationValues.length > AUDIO_CALIBRATION_FRAMES) {
                    const mean = calibrationValues.reduce((a, b) => a + b, 0) / calibrationValues.length
                    const variance = calibrationValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / calibrationValues.length
                    const std = Math.sqrt(variance)
                    noiseFloor.value = mean + std * 2 // Gate above ambient noise
                    calibrating.value = false
                    calibrationValues = []
                }
                requestAnimationFrame(checkAudioLevel)
                return
            }

            // Hysteresis thresholds
            const attackThreshold = noiseFloor.value * ATTACK_THRESHOLD_MULTIPLIER
            const releaseThreshold = noiseFloor.value * RELEASE_THRESHOLD_MULTIPLIER

            if (rms > attackThreshold) {
                attackFrames += 1
                releaseFrames = Math.max(releaseFrames - 1, 0)
            } else if (rms < releaseThreshold) {
                releaseFrames += 1
                attackFrames = Math.max(attackFrames - 1, 0)
            }

            // Determine speaking state with sustain
            if (attackFrames > ATTACK_FRAME_COUNT) {
                isSpeaking.value = true
            } else if (releaseFrames > RELEASE_FRAME_COUNT) {
                isSpeaking.value = false
            }

            // Trigger violation if speaking and cooldown passed
            const now = Date.now()
            if (isSpeaking.value && now - lastMicViolationAt > MIC_VIOLATION_COOLDOWN_MS) {
                onSpeakingViolation()
                lastMicViolationAt = now
            }

            requestAnimationFrame(checkAudioLevel)
        }

        checkAudioLevel()
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    /**
     * Stops microphone monitoring and releases resources.
     */
    function stopMicrophone(): void {
        if (audioStream.value) {
            audioStream.value.getTracks().forEach(track => track.stop())
            audioStream.value = null
        }
        if (audioContext.value) {
            audioContext.value.close()
            audioContext.value = null
        }
        isMicrophoneActive.value = false
    }

    // -------------------------------------------------------------------------
    // Return
    // -------------------------------------------------------------------------

    return {
        // State
        isMicrophoneActive,
        audioLevel,
        isSpeaking,
        calibrating,

        // Methods
        setupMicrophone,
        stopMicrophone
    }
}

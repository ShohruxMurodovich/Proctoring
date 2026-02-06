/**
 * Proctoring Composable
 * 
 * Handles error reporting, violation tracking, and API communication
 * for the proctoring system.
 */

import { ref } from 'vue'
import { API_BASE_URL, RATE_LIMIT_MS, INITIAL_SCORE, MIN_PASSING_SCORE } from '@/constants'





export interface ExamError {
    id: number
    name1: string
    name2: string
    name3: string
    name4: string
    long01: string
    ball: number
}

export interface ViolationEntry {
    err_id: number
    ball: number
    img?: string  // Base64 image data
}





export function useProctoring(examId: string, captureImage?: () => string | null) {




    const errorList = ref<ExamError[]>([])
    const sessionErrors = ref<ViolationEntry[]>([])
    const lastReportedAt = ref<Record<number, number>>({})
    const violationCount = ref(0)
    const isInside = ref(false)
    const text = ref('')
    const userScore = ref(INITIAL_SCORE)
    const isExamStarted = ref(false)
    const recordedVideoId = ref<string | null>(null) // Store uploaded video ID





    /**
     * Fetches the list of possible exam errors from the API.
     */
    async function fetchErrorList(): Promise<void> {
        try {
            const res = await fetch(`${API_BASE_URL}/v1/exam/errors?exam_id=${examId}`)
            if (res.ok) {
                const data = await res.json()

                if (data?.data?.err_list && Array.isArray(data.data.err_list)) {
                    errorList.value = data.data.err_list

                    if (data.data.user_err && Array.isArray(data.data.user_err) && data.data.user_err.length > 0) {
                        sessionErrors.value = data.data.user_err.map((e: any) => ({
                            err_id: e.err_id,
                            ball: e.ball,
                            img: e.img  // Capture image data from API
                        }))
                    }
                }
                else if (Array.isArray(data)) {
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

    /**
     * Sends an error report to the API with rate limiting.
     * @param errorId - The ID of the error to report
     */
    async function sendError(errorId: number): Promise<void> {
        if (!examId || !isExamStarted.value) return

        const now = Date.now()
        const lastTime = lastReportedAt.value[errorId] || 0
        if (now - lastTime < RATE_LIMIT_MS) {
            return
        }
        lastReportedAt.value[errorId] = now

        try {
            // Find error definition to get ball value
            const errorDef = errorList.value.find(e => e.id === errorId)
            const penalty = errorDef?.ball || 0

            // Deduct score
            if (userScore.value > 0) {
                userScore.value = Math.max(0, userScore.value - penalty)
            }

            // Add to session array
            const errorEntry: ViolationEntry = {
                err_id: errorId,
                ball: penalty
            }
            sessionErrors.value.push(errorEntry)

            // Check for failure condition
            if (userScore.value < MIN_PASSING_SCORE) {
                handleExamFailure()
            }

            // Capture image when error occurs
            let base64Image: string | null = null
            if (captureImage) {
                const imageData = captureImage()
                if (imageData) {
                    // Remove data:image/jpeg;base64, prefix if present
                    base64Image = imageData.includes(',') ? imageData.split(',')[1] : imageData
                }
            }

            // Send to backend with image
            const url = `${API_BASE_URL}/v1/exam/error`
            const payload = {
                exam_id: examId,
                err_id: errorId,
                img: base64Image
            }

            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })

            if (!res.ok) {
                console.error('Failed to report error to API:', res.status)
            }
        } catch (e) {
            console.error('Exception reporting error:', e)
        }
    }


    function handleExamFailure() {
        console.warn('USER FAILED EXAM (Score < 50)')
        alert('Imtixon topshirilmadi! (Ball yetarli emas)')
    }

    /**
     * Reports a violation to the system.
     * @param message - User-facing violation message
     * @param errorId - The ID of the error to report
     */
    function reportViolation(message: string, errorId: number): void {
        violationCount.value++
        isInside.value = false
        text.value = `${message} (${violationCount.value}-chi marta)`

        if (errorId) {
            sendError(errorId)
        }
    }

    /**
     * Resets the violation state to "safe" status.
     */
    function resetViolationState(): void {
        isInside.value = true
        text.value = ''
    }

    function startExam() {
        isExamStarted.value = true
    }

    /**
     * Stops the exam monitoring and resets state.
     */
    function stopProctoring() {
        isExamStarted.value = false
    }

    /**
     * Uploads the recorded video to the API and stores the video ID.
     * @param videoBlob - The recorded video blob
     * @returns Promise<string | null> The uploaded video ID
     */
    async function uploadVideo(videoBlob: Blob | null): Promise<string | null> {
        if (!videoBlob) {
            console.warn('No video blob to upload')
            return null
        }

        try {
            const formData = new FormData()
            formData.append('file', videoBlob, 'exam-recording.webm')

            const url = `https://kasbiy-talim.uz/services/platon-core/web/v1/public/files/upload/category/record`
            const res = await fetch(url, {
                method: 'POST',
                body: formData
            })

            if (!res.ok) {
                throw new Error(`Upload failed: ${res.status}`)
            }

            const data = await res.json()

            if (data && data.id) {
                recordedVideoId.value = data.id
                console.log(`Video uploaded successfully. ID: ${data.id}`)
                return data.id
            } else {
                console.error('Upload response missing video ID:', data)
                return null
            }
        } catch (error) {
            console.error('Video upload failed:', error)
            return null
        }
    }

    /**
     * Submits the final report of all violations.
     */
    async function finishExam() {
        stopProctoring()

        try {
            const payload = {
                exam_id: examId,
                errors: sessionErrors.value,
                video: recordedVideoId.value // Include video ID in final report
            }

            const res = await fetch(`${API_BASE_URL}/v1/exam/errors`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (!res.ok) {
                console.error('Failed to submit final report:', res.status)
            }
        } catch (e) {
            console.error('Exception submitting final report:', e)
        }
    }





    return {

        errorList,
        sessionErrors,
        violationCount,
        isInside,
        text,
        userScore,
        isExamStarted,

        // Methods
        fetchErrorList,
        sendError,
        reportViolation,
        resetViolationState,
        startExam,
        stopProctoring,
        finishExam,
        uploadVideo
    }
}

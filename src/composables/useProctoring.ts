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
}





export function useProctoring(examId: string) {




    const errorList = ref<ExamError[]>([])
    const sessionErrors = ref<ViolationEntry[]>([])
    const lastReportedAt = ref<Record<number, number>>({})
    const violationCount = ref(0)
    const isInside = ref(false)
    const text = ref('')
    const userScore = ref(INITIAL_SCORE)
    const isExamStarted = ref(false)





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
                            ball: e.ball
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

            // Send to backend
            const url = `${API_BASE_URL}/v1/exam/error?exam_id=${examId}&err_id=${errorId}`
            const res = await fetch(url, { method: 'PUT' })
            if (!res.ok) {
                console.error('Failed to report error to API:', res.status)
            }
        } catch (e) {
            console.error('Exception reporting error:', e)
        }
    }

    /**
     * Handles exam failure when score drops below threshold.
     */
    function handleExamFailure() {
        console.warn('USER FAILED EXAM (Score < 50)')
        alert('Imtixon topshirilmadi! (Ball yetarli emas)')
        // TODO: Emit failure event as requested later
    }

    /**
     * Reports a violation with UI update and API call.
     * Should only be called after face verification is complete.
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
     * Submits the final report of all violations.
     * @param apiEndpoint - Optional endpoint if provided later
     */
    /**
     * Submits the final report of all violations.
     */
    async function finishExam() {
        stopProctoring()

        try {
            const payload = {
                exam_id: examId,
                errors: sessionErrors.value
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
        finishExam
    }
}

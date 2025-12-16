/**
 * Proctoring Composable
 * 
 * Handles error reporting, violation tracking, and API communication
 * for the proctoring system.
 */

import { ref } from 'vue'
import { API_BASE_URL, RATE_LIMIT_MS } from '@/constants'

// =============================================================================
// Types
// =============================================================================

export interface ExamError {
    id: number
    name1: string
    name2: string
    name3: string
    name4: string
    long01: string
}

export interface ViolationEntry {
    exam_id: string
    err_id: number
    timestamp: string
}

// =============================================================================
// Composable
// =============================================================================

export function useProctoring(examId: string) {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    const errorList = ref<ExamError[]>([])
    const sessionErrors = ref<ViolationEntry[]>([])
    const lastReportedAt = ref<Record<number, number>>({})
    const violationCount = ref(0)
    const isInside = ref(false)
    const text = ref('')

    // -------------------------------------------------------------------------
    // API Methods
    // -------------------------------------------------------------------------

    /**
     * Fetches the list of possible exam errors from the API.
     */
    async function fetchErrorList(): Promise<void> {
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

    /**
     * Sends an error report to the API with rate limiting.
     * @param errorId - The ID of the error to report
     */
    async function sendError(errorId: number): Promise<void> {
        if (!examId) return

        // Rate limiting check
        const now = Date.now()
        const lastTime = lastReportedAt.value[errorId] || 0
        if (now - lastTime < RATE_LIMIT_MS) {
            console.log(`Error ${errorId} suppressed (rate limit)`)
            return
        }
        lastReportedAt.value[errorId] = now

        try {
            // Add to session array
            const errorEntry: ViolationEntry = {
                exam_id: examId,
                err_id: errorId,
                timestamp: new Date().toISOString()
            }
            sessionErrors.value.push(errorEntry)
            console.log('Violation detected & added to session:', errorEntry)

            // Send to backend
            const url = `${API_BASE_URL}/v1/exam/error?exam_id=${examId}&err_id=${errorId}`
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

    // -------------------------------------------------------------------------
    // Return
    // -------------------------------------------------------------------------

    return {
        // State
        errorList,
        sessionErrors,
        violationCount,
        isInside,
        text,

        // Methods
        fetchErrorList,
        sendError,
        reportViolation,
        resetViolationState
    }
}

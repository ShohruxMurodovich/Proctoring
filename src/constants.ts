/**
 * Centralized configuration constants for the proctoring application.
 * All magic numbers and thresholds are defined here for easy adjustment.
 */

// =============================================================================
// API Configuration
// =============================================================================

export const API_BASE_URL = 'https://kasbiy-talim.uz/services/platon-core/api'

// =============================================================================
// Timing Constants
// =============================================================================

/** Minimum interval between same error reports (ms) */
export const RATE_LIMIT_MS = 3000

/** Time a violation must persist before being reported (ms) */
export const VIOLATION_PERSISTENCE_MS = 3000

/** Interval for automatic photo uploads (ms) */
export const AUTO_PHOTO_INTERVAL_MS = 30000

/** Face detection interval (ms) */
export const FACE_DETECTION_INTERVAL_MS = 200

// =============================================================================
// Face Detection Thresholds
// =============================================================================

/** Eye Aspect Ratio threshold for blink detection */
export const BLINK_THRESHOLD = 0.22

/** Maximum EAR difference between eyes for consistent blink */
export const CONSISTENT_BLINK_THRESHOLD = 0.05

/** Normalized offset threshold for head turn detection */
export const HEAD_TURN_THRESHOLD = 0.15

/** Pitch angle threshold for looking up/down (degrees) */
export const PITCH_THRESHOLD = 15

/** Number of frames to average for smoothing */
export const SMOOTHING_HISTORY_LENGTH = 5

// =============================================================================
// Distance Detection
// =============================================================================

/** Minimum distance from camera (mm) - too close warning */
export const MIN_CAMERA_DISTANCE_MM = 300

/** Maximum distance from camera (mm) - too far warning */
export const MAX_CAMERA_DISTANCE_MM = 800

/** Reference face area for distance calculation */
export const REFERENCE_FACE_AREA = 15000

/** Reference distance for distance calculation (mm) */
export const REFERENCE_DISTANCE_MM = 600

// =============================================================================
// UI Configuration
// =============================================================================

/** Radius of the circular face boundary on screen */
export const CIRCLE_BOUNDARY_RADIUS = 148

// =============================================================================
// Audio Monitoring
// =============================================================================

/** Number of frames for audio calibration */
export const AUDIO_CALIBRATION_FRAMES = 90

/** Attack threshold multiplier for speech detection */
export const ATTACK_THRESHOLD_MULTIPLIER = 1.6

/** Release threshold multiplier for speech detection */
export const RELEASE_THRESHOLD_MULTIPLIER = 1.2

/** Frames required to trigger speaking state */
export const ATTACK_FRAME_COUNT = 10

/** Frames required to release speaking state */
export const RELEASE_FRAME_COUNT = 15

/** Cooldown between microphone violations (ms) */
export const MIC_VIOLATION_COOLDOWN_MS = 5000

// =============================================================================
// File Limits
// =============================================================================

/** Maximum upload size for recordings (bytes) */
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024 // 256MB

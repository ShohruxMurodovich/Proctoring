/**
 * Browser Compatibility Composable
 * 
 * Detects browser type, version, and API support for cross-browser compatibility.
 * Provides fallbacks and warnings for Opera and other browsers.
 */

import { ref, computed } from 'vue'


export interface BrowserInfo {
    name: string
    version: string
    isOpera: boolean
    isChrome: boolean
    isFirefox: boolean
    isSafari: boolean
}

export interface FeatureSupport {
    getUserMedia: boolean
    mediaRecorder: boolean
    fullscreen: boolean
    webRTC: boolean
}

export function useBrowserCompatibility() {
    const browserInfo = ref<BrowserInfo>(detectBrowser())
    const featureSupport = ref<FeatureSupport>(checkFeatureSupport())

    /**
     * Detects the browser name and version
     */
    function detectBrowser(): BrowserInfo {
        const ua = navigator.userAgent
        let name = 'Unknown'
        let version = 'Unknown'

        // Check for Opera
        if (ua.indexOf('OPR/') > -1 || ua.indexOf('Opera/') > -1) {
            name = 'Opera'
            const match = ua.match(/(?:OPR|Opera)[\/\s](\d+\.\d+)/)
            version = match ? match[1] : 'Unknown'
        }
        // Check for Chrome
        else if (ua.indexOf('Chrome/') > -1 && ua.indexOf('Edg') === -1) {
            name = 'Chrome'
            const match = ua.match(/Chrome\/(\d+\.\d+)/)
            version = match ? match[1] : 'Unknown'
        }
        // Check for Firefox
        else if (ua.indexOf('Firefox/') > -1) {
            name = 'Firefox'
            const match = ua.match(/Firefox\/(\d+\.\d+)/)
            version = match ? match[1] : 'Unknown'
        }
        // Check for Safari
        else if (ua.indexOf('Safari/') > -1 && ua.indexOf('Chrome') === -1) {
            name = 'Safari'
            const match = ua.match(/Version\/(\d+\.\d+)/)
            version = match ? match[1] : 'Unknown'
        }

        return {
            name,
            version,
            isOpera: name === 'Opera',
            isChrome: name === 'Chrome',
            isFirefox: name === 'Firefox',
            isSafari: name === 'Safari'
        }
    }

    /**
     * Checks support for required web APIs
     */
    function checkFeatureSupport(): FeatureSupport {
        return {
            getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            mediaRecorder: typeof MediaRecorder !== 'undefined',
            fullscreen: !!(
                document.fullscreenEnabled ||
                (document as any).webkitFullscreenEnabled ||
                (document as any).mozFullScreenEnabled ||
                (document as any).msFullscreenEnabled
            ),
            webRTC: !!(window.RTCPeerConnection || (window as any).webkitRTCPeerConnection)
        }
    }

    /**
     * Gets supported MediaRecorder MIME types in priority order
     */
    function getSupportedMimeTypes(): string[] {
        const types = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
        ]

        return types.filter(type => {
            try {
                return MediaRecorder.isTypeSupported(type)
            } catch {
                return false
            }
        })
    }

    /**
     * Gets the best available MIME type for MediaRecorder
     */
    function getPreferredMimeType(): string | null {
        const supported = getSupportedMimeTypes()
        return supported.length > 0 ? supported[0] : null
    }

    /**
     * Requests fullscreen with vendor prefix support
     */
    function requestFullscreen(element: HTMLElement): Promise<void> {
        if (element.requestFullscreen) {
            return element.requestFullscreen()
        } else if ((element as any).webkitRequestFullscreen) {
            return (element as any).webkitRequestFullscreen()
        } else if ((element as any).mozRequestFullScreen) {
            return (element as any).mozRequestFullScreen()
        } else if ((element as any).msRequestFullscreen) {
            return (element as any).msRequestFullscreen()
        }
        return Promise.reject(new Error('Fullscreen API not supported'))
    }

    /**
     * Exits fullscreen with vendor prefix support
     */
    function exitFullscreen(): Promise<void> {
        if (document.exitFullscreen) {
            return document.exitFullscreen()
        } else if ((document as any).webkitExitFullscreen) {
            return (document as any).webkitExitFullscreen()
        } else if ((document as any).mozCancelFullScreen) {
            return (document as any).mozCancelFullScreen()
        } else if ((document as any).msExitFullscreen) {
            return (document as any).msExitFullscreen()
        }
        return Promise.reject(new Error('Fullscreen API not supported'))
    }

    /**
     * Gets the current fullscreen element with vendor prefix support
     */
    function getFullscreenElement(): Element | null {
        return (
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement ||
            (document as any).msFullscreenElement ||
            null
        )
    }

    /**
     * Adds fullscreen change listener with vendor prefix support
     */
    function onFullscreenChange(callback: () => void): () => void {
        const events = [
            'fullscreenchange',
            'webkitfullscreenchange',
            'mozfullscreenchange',
            'MSFullscreenChange'
        ]

        events.forEach(event => {
            document.addEventListener(event, callback)
        })

        // Return cleanup function
        return () => {
            events.forEach(event => {
                document.removeEventListener(event, callback)
            })
        }
    }

    const hasFullSupport = computed(() => {
        return (
            featureSupport.value.getUserMedia &&
            featureSupport.value.mediaRecorder &&
            featureSupport.value.fullscreen
        )
    })

    const compatibilityWarnings = computed(() => {
        const warnings: string[] = []

        if (!featureSupport.value.getUserMedia) {
            warnings.push('Camera access not supported in this browser')
        }
        if (!featureSupport.value.mediaRecorder) {
            warnings.push('Video recording not supported in this browser')
        }
        if (!featureSupport.value.fullscreen) {
            warnings.push('Fullscreen mode not supported in this browser')
        }

        return warnings
    })

    return {
        browserInfo,
        featureSupport,
        hasFullSupport,
        compatibilityWarnings,
        getSupportedMimeTypes,
        getPreferredMimeType,
        requestFullscreen,
        exitFullscreen,
        getFullscreenElement,
        onFullscreenChange
    }
}

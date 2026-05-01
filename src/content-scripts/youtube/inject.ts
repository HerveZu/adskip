// MAIN-world script: monkey-patches fetch + XHR to capture YouTube's
// timedtext caption JSON, and — when the user has CC off — briefly clicks
// YouTube's own CC button so the player fetches captions, which our
// patched fetch then intercepts.

;(() => {
    if ((window as unknown as { __adskipInjected?: boolean }).__adskipInjected) return
    ;(window as unknown as { __adskipInjected?: boolean }).__adskipInjected = true

    const TAG = '[adskip:inject]'
    const TIMEDTEXT_RE = /\/api\/timedtext\b/

    const interceptedVideos = new Set<string>()
    const handledVideos = new Set<string>()
    const inFlight = new Set<string>()

    function postCaptions(url: string, payload: unknown) {
        try {
            window.postMessage(
                { source: 'adskip', type: 'captions', url, payload },
                window.location.origin
            )
        } catch (e) {
            console.warn(TAG, 'postMessage(captions) failed', e)
        }
    }

    function postStatus(videoId: string | null, status: string) {
        try {
            window.postMessage(
                { source: 'adskip', type: 'status', videoId, status },
                window.location.origin
            )
        } catch {
            /* noop */
        }
    }

    function videoIdFromUrl(url: string): string | null {
        const m = url.match(/[?&]v=([^&]+)/)
        return m ? decodeURIComponent(m[1]) : null
    }

    const origFetch = window.fetch.bind(window)
    window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url
        const res = await origFetch(input, init)
        if (TIMEDTEXT_RE.test(url) && res.ok) {
            try {
                const clone = res.clone()
                clone.json()
                    .then(j => {
                        const id = videoIdFromUrl(url)
                        if (id) interceptedVideos.add(id)
                        postCaptions(url, j)
                    })
                    .catch(() => {
                        /* not JSON — ignore */
                    })
            } catch (e) {
                console.warn(TAG, 'fetch clone failed', e)
            }
        }
        return res
    }

    const origOpen = XMLHttpRequest.prototype.open
    const origSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (
        this: XMLHttpRequest & { __adskipUrl?: string },
        method: string,
        url: string | URL,
        ...rest: unknown[]
    ) {
        this.__adskipUrl = typeof url === 'string' ? url : url.href
        // @ts-expect-error spread into native signature
        return origOpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (
        this: XMLHttpRequest & { __adskipUrl?: string },
        body?: Document | XMLHttpRequestBodyInit | null
    ) {
        const url = this.__adskipUrl
        if (url && TIMEDTEXT_RE.test(url)) {
            this.addEventListener('load', () => {
                if (this.status < 200 || this.status >= 300) return
                try {
                    const txt =
                        this.responseType === '' || this.responseType === 'text'
                            ? this.responseText
                            : null
                    if (!txt) return
                    const j = JSON.parse(txt)
                    const id = videoIdFromUrl(url)
                    if (id) interceptedVideos.add(id)
                    postCaptions(url, j)
                } catch {
                    /* not JSON — ignore */
                }
            })
        }
        return origSend.call(this, body)
    }

    function readVideoId(): string | null {
        if (location.pathname !== '/watch') return null
        return new URLSearchParams(location.search).get('v')
    }

    function findCcButton(): HTMLButtonElement | null {
        return document.querySelector<HTMLButtonElement>('.ytp-subtitles-button')
    }

    function isVisible(el: HTMLElement): boolean {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false
        return getComputedStyle(el).display !== 'none'
    }

    async function waitForCcButton(timeoutMs: number): Promise<HTMLButtonElement | null> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const btn = findCcButton()
            if (btn && isVisible(btn)) return btn
            await new Promise(r => setTimeout(r, 150))
        }
        return null
    }

    async function waitForIntercept(videoId: string, timeoutMs: number): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            if (interceptedVideos.has(videoId)) return true
            await new Promise(r => setTimeout(r, 100))
        }
        return false
    }

    function isAdPlaying(): boolean {
        const player = document.querySelector<HTMLElement>('#movie_player')
        if (!player) return false
        return (
            player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting')
        )
    }

    // YouTube serves pre-roll ads before the main video; while one is on
    // screen the timedtext API hasn't been hit for the real video yet, so
    // toggling CC fires into the ad player and waitForIntercept times out.
    // Block the flow until the ad ends — or until the timeout, in case the
    // class never clears (e.g. ad blocker masks the state).
    async function waitForNoAd(timeoutMs: number): Promise<void> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            if (!isAdPlaying()) return
            await new Promise(r => setTimeout(r, 250))
        }
    }

    async function ensureCaptions(videoId: string): Promise<void> {
        if (handledVideos.has(videoId) || inFlight.has(videoId)) return
        inFlight.add(videoId)
        handledVideos.add(videoId)

        try {
            postStatus(videoId, 'fetching')

            // Wait out any pre-roll ad before touching the CC button.
            await waitForNoAd(180_000)
            if (videoId !== readVideoId()) return
            if (interceptedVideos.has(videoId)) return

            // Give YouTube a moment to fetch captions itself if CC is already on.
            await new Promise(r => setTimeout(r, 1000))
            if (interceptedVideos.has(videoId)) return

            const btn = await waitForCcButton(5000)
            if (!btn) {
                postStatus(videoId, 'unavailable')
                return
            }

            const wasPressed = btn.getAttribute('aria-pressed') === 'true'

            // Toggle CC on only if it was off — never disrupt a user who already has it on.
            if (!wasPressed) btn.click()

            const ok = await waitForIntercept(videoId, 4000)

            // Restore original state if we changed it.
            if (!wasPressed && btn.getAttribute('aria-pressed') === 'true') {
                btn.click()
            }

            if (!ok) postStatus(videoId, 'fetch-failed')
        } finally {
            inFlight.delete(videoId)
        }
    }

    function maybeRun() {
        const id = readVideoId()
        if (!id) return
        ensureCaptions(id)
    }

    // Allow the isolated content script to force a fresh ensureCaptions
    // (e.g. when the popup's Recheck button is hit while still pending).
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.source !== window) return
        const data = e.data as { source?: string; type?: string; videoId?: string }
        if (!data || data.source !== 'adskip-content') return
        if (data.type === 'force-fetch') {
            const id = data.videoId || readVideoId()
            if (!id) return
            handledVideos.delete(id)
            ensureCaptions(id)
        }
    })

    let adSkipEnabled = true
    let adSkipObserver: MutationObserver | null = null
    let adSkipInterval: ReturnType<typeof setInterval> | null = null
    let wasMutedByAdskip = false
    let savedPlaybackRate = 1
    let adStartTimeMs: number | null = null

    function postAdSkipped(durationMs: number) {
        try {
            window.postMessage(
                { source: 'adskip', type: 'ad-skipped', durationMs },
                window.location.origin
            )
        } catch {
            /* noop */
        }
    }

    function findSkipButton(): HTMLButtonElement | null {
        return document.querySelector<HTMLButtonElement>(
            '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button'
        )
    }

    function getVideoEl(): HTMLVideoElement | null {
        return document.querySelector<HTMLVideoElement>('video.html5-main-video, video')
    }

    function handleAdState() {
        if (!adSkipEnabled) return
        const player = document.querySelector<HTMLElement>('#movie_player')
        if (!player) return
        const adActive =
            player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting')

        if (adActive) {
            const video = getVideoEl()
            if (video) {
                if (!adStartTimeMs) {
                    adStartTimeMs = Date.now()
                    savedPlaybackRate = video.playbackRate
                    wasMutedByAdskip = video.muted === false
                    video.muted = true
                }
                if (video.playbackRate < 16) {
                    video.playbackRate = 16
                }
            }
            const btn = findSkipButton()
            if (btn) btn.click()
        } else if (adStartTimeMs !== null) {
            const video = getVideoEl()
            if (video) {
                video.playbackRate = savedPlaybackRate
                if (wasMutedByAdskip) video.muted = false
            }
            const durationMs = Date.now() - adStartTimeMs
            adStartTimeMs = null
            wasMutedByAdskip = false
            postAdSkipped(durationMs)
        }
    }

    function startAdSkipObserver() {
        if (adSkipObserver) return
        const player = document.querySelector<HTMLElement>('#movie_player')
        if (!player) {
            setTimeout(startAdSkipObserver, 2000)
            return
        }
        adSkipObserver = new MutationObserver(() => handleAdState())
        adSkipObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
        adSkipInterval = setInterval(() => {
            if (adSkipEnabled) handleAdState()
        }, 500)
    }

    function stopAdSkipObserver() {
        if (adSkipObserver) {
            adSkipObserver.disconnect()
            adSkipObserver = null
        }
        if (adSkipInterval) {
            clearInterval(adSkipInterval)
            adSkipInterval = null
        }
        if (adStartTimeMs !== null) {
            const video = getVideoEl()
            if (video) {
                video.playbackRate = savedPlaybackRate
                if (wasMutedByAdskip) video.muted = false
            }
            adStartTimeMs = null
            wasMutedByAdskip = false
        }
    }

    window.addEventListener('message', (e: MessageEvent) => {
        if (e.source !== window) return
        const data = e.data as { source?: string; type?: string; skipAds?: boolean }
        if (!data || data.source !== 'adskip-content') return
        if (data.type === 'skip-ads-setting') {
            adSkipEnabled = data.skipAds ?? true
            if (adSkipEnabled) {
                startAdSkipObserver()
            } else {
                stopAdSkipObserver()
            }
        }
    })

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => startAdSkipObserver(), {
            once: true,
        })
    } else {
        startAdSkipObserver()
    }

    window.addEventListener('yt-navigate-finish', () => setTimeout(maybeRun, 500))
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeRun, { once: true })
    } else {
        maybeRun()
    }

    console.debug(TAG, 'installed')
})()

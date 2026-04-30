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

    async function ensureCaptions(videoId: string): Promise<void> {
        if (handledVideos.has(videoId)) return
        handledVideos.add(videoId)

        // Give YouTube a moment to fetch captions itself if CC is already on.
        await new Promise(r => setTimeout(r, 1500))
        if (interceptedVideos.has(videoId)) return

        postStatus(videoId, 'fetching')

        const btn = await waitForCcButton(10000)
        if (!btn) {
            postStatus(videoId, 'unavailable')
            return
        }

        const wasPressed = btn.getAttribute('aria-pressed') === 'true'

        // Toggle CC on only if it was off — never disrupt a user who already has it on.
        if (!wasPressed) btn.click()

        const ok = await waitForIntercept(videoId, 5000)

        // Restore original state if we changed it.
        if (!wasPressed && btn.getAttribute('aria-pressed') === 'true') {
            btn.click()
        }

        if (!ok) postStatus(videoId, 'fetch-failed')
    }

    function maybeRun() {
        const id = readVideoId()
        if (!id) return
        ensureCaptions(id)
    }

    window.addEventListener('yt-navigate-finish', () => setTimeout(maybeRun, 500))
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeRun, { once: true })
    } else {
        maybeRun()
    }

    console.debug(TAG, 'installed')
})()

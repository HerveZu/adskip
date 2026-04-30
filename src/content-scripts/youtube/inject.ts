// MAIN-world script: monkey-patches fetch + XHR to capture YouTube's
// timedtext caption JSON, and auto-fetches the caption track from
// ytInitialPlayerResponse when the user hasn't turned on CC.

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
                        /* not JSON (e.g. xml/srv3 format) — ignore */
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

    interface CaptionTrack {
        baseUrl: string
        languageCode?: string
        kind?: string
        vssId?: string
    }

    function readVideoId(): string | null {
        if (location.pathname !== '/watch') return null
        return new URLSearchParams(location.search).get('v')
    }

    type PlayerResponse = {
        videoDetails?: { videoId?: string }
        captions?: {
            playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] }
        }
    }

    function readPlayerResponse(): PlayerResponse | null {
        const w = window as unknown as {
            ytInitialPlayerResponse?: PlayerResponse
            ytplayer?: { config?: { args?: { raw_player_response?: PlayerResponse } } }
        }
        return (
            w.ytInitialPlayerResponse ??
            w.ytplayer?.config?.args?.raw_player_response ??
            null
        )
    }

    function waitForPlayerResponse(timeoutMs: number): Promise<PlayerResponse | null> {
        return new Promise(resolve => {
            const start = Date.now()
            const tick = () => {
                const r = readPlayerResponse()
                if (r) {
                    resolve(r)
                    return
                }
                if (Date.now() - start > timeoutMs) {
                    resolve(null)
                    return
                }
                setTimeout(tick, 100)
            }
            tick()
        })
    }

    function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
        const englishManual = tracks.find(
            t => t.languageCode?.startsWith('en') && t.kind !== 'asr'
        )
        if (englishManual) return englishManual
        const english = tracks.find(t => t.languageCode?.startsWith('en'))
        if (english) return english
        const manual = tracks.find(t => t.kind !== 'asr')
        return manual ?? tracks[0]
    }

    function withJson3(url: string): string {
        try {
            const u = new URL(url, location.origin)
            u.searchParams.set('fmt', 'json3')
            return u.toString()
        } catch {
            return url + (url.includes('?') ? '&' : '?') + 'fmt=json3'
        }
    }

    async function tryAutoFetch(videoId: string): Promise<void> {
        if (handledVideos.has(videoId)) return
        handledVideos.add(videoId)

        // Give YouTube ~1.5s to fetch captions itself if CC is on.
        await new Promise(r => setTimeout(r, 1500))
        if (interceptedVideos.has(videoId)) return

        postStatus(videoId, 'fetching')

        const pr = await waitForPlayerResponse(8000)
        if (!pr) {
            postStatus(videoId, 'fetch-failed')
            return
        }
        const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks
        if (!Array.isArray(tracks) || tracks.length === 0) {
            postStatus(videoId, 'unavailable')
            return
        }

        const track = pickTrack(tracks)
        if (!track?.baseUrl) {
            postStatus(videoId, 'unavailable')
            return
        }

        if (interceptedVideos.has(videoId)) return

        const url = withJson3(track.baseUrl)
        try {
            const res = await origFetch(url, { credentials: 'include' })
            if (!res.ok) {
                postStatus(videoId, 'fetch-failed')
                return
            }
            const json = await res.json()
            interceptedVideos.add(videoId)
            postCaptions(url, json)
        } catch (e) {
            console.warn(TAG, 'auto-fetch failed', e)
            postStatus(videoId, 'fetch-failed')
        }
    }

    function maybeAutoFetch() {
        const id = readVideoId()
        if (!id) return
        tryAutoFetch(id)
    }

    window.addEventListener('yt-navigate-finish', () => setTimeout(maybeAutoFetch, 100))
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeAutoFetch, { once: true })
    } else {
        maybeAutoFetch()
    }

    console.debug(TAG, 'installed')
})()

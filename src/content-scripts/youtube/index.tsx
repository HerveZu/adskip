import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CaptionsOff, Check, X } from 'lucide-react'
import styles from '@/styles/index.css?inline'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDurationCompact } from '@/lib/utils'
import Overlay from './Overlay'
import { computeSkipState } from './skipController'
import type {
    AdSegment,
    CaptionPayload,
    CaptionStatus,
    RuntimeMessage,
    TabState,
} from './types'

const TAG = '[adskip:content]'
const ROOT_ID = 'adskip-root'

// Inject the MAIN-world script via <script src> at document_start so its
// fetch/XHR patches are in place before YouTube's player code runs.
function injectMainWorldScript() {
    if (document.getElementById('adskip-inject')) return
    const s = document.createElement('script')
    s.id = 'adskip-inject'
    s.src = chrome.runtime.getURL('js/inject.js')
    s.async = false
    ;(document.head || document.documentElement).appendChild(s)
    s.addEventListener('load', () => s.remove())
}
injectMainWorldScript()

const segmentsByVideo = new Map<string, AdSegment[]>()
const captionsByVideo = new Map<string, CaptionPayload>()
const captionStatusByVideo = new Map<string, CaptionStatus>()
const analyzingVideos = new Set<string>()
let currentVideoId: string | null = null
let currentVideoEl: HTMLVideoElement | null = null

function getCaptionStatus(videoId: string | null): CaptionStatus {
    if (!videoId) return 'pending'
    if (captionsByVideo.has(videoId)) return 'captured'
    return captionStatusByVideo.get(videoId) ?? 'pending'
}

function readVideoId(): string | null {
    if (location.pathname !== '/watch') return null
    return new URLSearchParams(location.search).get('v')
}
function refreshVideoId() {
    const next = readVideoId()
    if (next !== currentVideoId) {
        currentVideoId = next
        window.dispatchEvent(new CustomEvent('adskip:videochange'))
    }
}
refreshVideoId()
window.addEventListener('yt-navigate-finish', refreshVideoId)
window.addEventListener('popstate', refreshVideoId)

window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return
    const data = e.data as {
        source?: string
        type?: string
        payload?: CaptionPayload
        videoId?: string
        status?: CaptionStatus
    }
    if (!data || data.source !== 'adskip') return

    if (data.type === 'captions') {
        const videoId = readVideoId()
        if (!videoId) return
        const payload = data.payload
        if (!payload?.events?.length) return
        captionsByVideo.set(videoId, payload)
        captionStatusByVideo.set(videoId, 'captured')
        analyzingVideos.add(videoId)
        window.dispatchEvent(new CustomEvent('adskip:status'))
        chrome.runtime
            .sendMessage<RuntimeMessage>({ type: 'ANALYZE_CAPTIONS', videoId, payload })
            .catch(err => console.warn(TAG, 'sendMessage failed', err))
        return
    }

    if (data.type === 'status' && data.videoId && data.status) {
        // A successful capture must not be downgraded by a later status update.
        const prev = captionStatusByVideo.get(data.videoId)
        if (prev !== 'captured') {
            captionStatusByVideo.set(data.videoId, data.status)
            window.dispatchEvent(new CustomEvent('adskip:status'))
        }
    }
})

chrome.runtime.onMessage.addListener(
    (msg: RuntimeMessage, _sender, sendResponse: (r?: unknown) => void) => {
        if (msg.type === 'AD_SEGMENTS') {
            segmentsByVideo.set(msg.videoId, msg.segments)
            analyzingVideos.delete(msg.videoId)
            if (msg.videoId === currentVideoId) {
                window.dispatchEvent(new CustomEvent('adskip:segments'))
            }
            return
        }
        if (msg.type === 'GET_STATE') {
            const videoId = readVideoId()
            const state: TabState = {
                videoId,
                currentTimeMs: currentVideoEl ? currentVideoEl.currentTime * 1000 : 0,
                captionStatus: getCaptionStatus(videoId),
                analyzing: videoId ? analyzingVideos.has(videoId) : false,
                segments: videoId ? (segmentsByVideo.get(videoId) ?? []) : [],
            }
            sendResponse(state)
            return
        }
        if (msg.type === 'RECHECK') {
            const videoId = readVideoId()
            if (!videoId) {
                sendResponse({ ok: false, error: 'Not on a YouTube video' })
                return
            }
            const payload = captionsByVideo.get(videoId)
            if (!payload) {
                // No captions captured yet — re-trigger the inject's CC-toggle
                // flow so the user isn't stuck on "Waiting for captions…".
                captionStatusByVideo.delete(videoId)
                window.dispatchEvent(new CustomEvent('adskip:status'))
                window.postMessage(
                    { source: 'adskip-content', type: 'force-fetch', videoId },
                    location.origin
                )
                sendResponse({ ok: true })
                return
            }
            analyzingVideos.add(videoId)
            chrome.runtime
                .sendMessage<RuntimeMessage>({
                    type: 'ANALYZE_CAPTIONS',
                    videoId,
                    payload,
                    force: true,
                })
                .then(() => sendResponse({ ok: true }))
                .catch(err => sendResponse({ ok: false, error: String(err?.message ?? err) }))
            return true
        }
    }
)

function getPlayerRect(): DOMRect | null {
    const fs = document.fullscreenElement as HTMLElement | null
    const p = fs ?? document.querySelector<HTMLElement>('#movie_player')
    return p?.getBoundingClientRect() ?? null
}

// Schedules a one-shot dismiss N ms after mount. The parent's callback can
// safely change identity on every render — we resolve through a ref so the
// timer isn't constantly reset.
function useAutoDismiss(onDismiss: () => void, ms: number) {
    const ref = useRef(onDismiss)
    useEffect(() => {
        ref.current = onDismiss
    })
    useEffect(() => {
        const id = window.setTimeout(() => ref.current(), ms)
        return () => clearTimeout(id)
    }, [ms])
}

function App() {
    const [videoId, setVideoId] = useState<string | null>(currentVideoId)
    const [segments, setSegments] = useState<AdSegment[]>([])
    const [cancelled, setCancelled] = useState<Set<string>>(new Set())
    const [silenced, setSilenced] = useState<Set<string>>(new Set())
    const [tMs, setTMs] = useState(0)
    const [video, setVideo] = useState<HTMLVideoElement | null>(null)
    const [settings, setSettings] = useState({ autoSkip: true, prerollSeconds: 10 })
    const [captionStatus, setCaptionStatus] = useState<CaptionStatus>('pending')
    const [toastDismissed, setToastDismissed] = useState(false)
    const [lastSkipped, setLastSkipped] = useState<{
        segId: string
        seconds: number
        at: number
    } | null>(null)
    const [playerRect, setPlayerRect] = useState<DOMRect | null>(getPlayerRect())

    useEffect(() => {
        const update = () => setPlayerRect(getPlayerRect())
        update()
        const ro = new ResizeObserver(update)
        const p = document.querySelector('#movie_player')
        if (p) ro.observe(p)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, { passive: true })
        document.addEventListener('fullscreenchange', update)
        const id = window.setInterval(update, 500)
        return () => {
            ro.disconnect()
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update)
            document.removeEventListener('fullscreenchange', update)
            clearInterval(id)
        }
    }, [])

    useEffect(() => {
        chrome.storage.local.get(['autoSkip', 'prerollSeconds']).then(s => {
            setSettings({
                autoSkip: s.autoSkip ?? true,
                prerollSeconds: s.prerollSeconds ?? 10,
            })
        })
        const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
            setSettings(prev => ({
                autoSkip: changes.autoSkip?.newValue ?? prev.autoSkip,
                prerollSeconds:
                    changes.prerollSeconds?.newValue ?? prev.prerollSeconds,
            }))
        }
        chrome.storage.local.onChanged.addListener(onChanged)
        return () => chrome.storage.local.onChanged.removeListener(onChanged)
    }, [])

    useEffect(() => {
        const onChange = () => {
            setVideoId(currentVideoId)
            setCancelled(new Set())
            setSilenced(new Set())
            setToastDismissed(false)
            setLastSkipped(null)
        }
        window.addEventListener('adskip:videochange', onChange)
        return () => window.removeEventListener('adskip:videochange', onChange)
    }, [])

    useEffect(() => {
        const sync = () => setSegments(videoId ? segmentsByVideo.get(videoId) ?? [] : [])
        sync()
        window.addEventListener('adskip:segments', sync)
        return () => window.removeEventListener('adskip:segments', sync)
    }, [videoId])

    useEffect(() => {
        const sync = () => setCaptionStatus(getCaptionStatus(videoId))
        sync()
        window.addEventListener('adskip:status', sync)
        return () => window.removeEventListener('adskip:status', sync)
    }, [videoId])

    useEffect(() => {
        if (!videoId) {
            currentVideoEl = null
            setVideo(null)
            return
        }
        let raf = 0
        const find = () => {
            const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')
            if (v) {
                currentVideoEl = v
                setVideo(v)
            } else {
                raf = requestAnimationFrame(find)
            }
        }
        find()
        return () => cancelAnimationFrame(raf)
    }, [videoId])

    useEffect(() => {
        if (!video) return
        const onTime = () => setTMs(video.currentTime * 1000)
        video.addEventListener('timeupdate', onTime)
        return () => video.removeEventListener('timeupdate', onTime)
    }, [video])

    const skip = computeSkipState({
        segments,
        timeMs: tMs,
        cancelled,
        autoSkip: settings.autoSkip,
        prerollSeconds: settings.prerollSeconds,
    })

    useEffect(() => {
        if (skip.shouldSkipTo == null || !video || !skip.activeWarning || !videoId) return
        if (Math.abs(video.currentTime - skip.shouldSkipTo) < 0.5) return
        const seg = skip.activeWarning
        const durationMs = seg.endMs - seg.startMs
        const at = Date.now()
        video.currentTime = skip.shouldSkipTo
        setLastSkipped({ segId: seg.id, seconds: Math.round(durationMs / 1000), at })

        const title = (document.title || '').replace(/\s*-\s*YouTube\s*$/, '').trim()
        chrome.runtime
            .sendMessage<RuntimeMessage>({
                type: 'RECORD_SKIP',
                record: {
                    id: `${videoId}-${seg.id}-${at}`,
                    videoId,
                    videoTitle: title,
                    summary: seg.summary,
                    durationMs,
                    skippedAt: at,
                },
            })
            .catch(() => {})
    }, [skip.shouldSkipTo, video, skip.activeWarning, videoId])

    const toastVisible =
        !toastDismissed &&
        videoId !== null &&
        (captionStatus === 'unavailable' || captionStatus === 'fetch-failed')

    const showWarning =
        !!skip.activeWarning && !silenced.has(skip.activeWarning.id)

    return (
        <>
            {showWarning && skip.activeWarning && (
                <Overlay
                    segment={skip.activeWarning}
                    secondsUntilSkip={skip.secondsUntilSkip ?? 0}
                    autoSkip={settings.autoSkip}
                    playerRect={playerRect}
                    onCancel={() =>
                        setCancelled(prev => {
                            const next = new Set(prev)
                            next.add(skip.activeWarning!.id)
                            return next
                        })
                    }
                    onDismiss={() =>
                        setSilenced(prev => {
                            const next = new Set(prev)
                            next.add(skip.activeWarning!.id)
                            return next
                        })
                    }
                />
            )}
            {toastVisible && (
                <PlayerToast
                    status={captionStatus}
                    playerRect={playerRect}
                    onDismiss={() => setToastDismissed(true)}
                />
            )}
            {lastSkipped && (
                <SkippedToast
                    key={lastSkipped.at}
                    seconds={lastSkipped.seconds}
                    playerRect={playerRect}
                    onDone={() => setLastSkipped(null)}
                />
            )}
        </>
    )
}

function topRightOnPlayer(rect: DOMRect | null) {
    if (!rect) return { top: 80, right: 24 }
    return {
        top: Math.max(8, rect.top + 16),
        right: Math.max(8, window.innerWidth - rect.right + 16),
    }
}

function SkippedToast({
    seconds,
    playerRect,
    onDone,
}: {
    seconds: number
    playerRect: DOMRect | null
    onDone: () => void
}) {
    useAutoDismiss(onDone, 5000)
    return (
        <Alert
            className="shadow-lg"
            style={{
                position: 'fixed',
                ...topRightOnPlayer(playerRect),
                width: 'auto',
                pointerEvents: 'auto',
                zIndex: 2147483646,
            }}
        >
            <Check />
            <AlertTitle>
                Skipped {formatDurationCompact(seconds * 1000)} of sponsored content
            </AlertTitle>
        </Alert>
    )
}

function PlayerToast({
    status,
    playerRect,
    onDismiss,
}: {
    status: CaptionStatus
    playerRect: DOMRect | null
    onDismiss: () => void
}) {
    useAutoDismiss(onDismiss, 5000)
    const text =
        status === 'unavailable'
            ? 'No captions on this video — sponsor detection unavailable.'
            : 'Couldn’t fetch the caption track for this video.'
    return (
        <Alert
            className="shadow-lg"
            style={{
                position: 'fixed',
                ...topRightOnPlayer(playerRect),
                width: 320,
                maxWidth: 'calc(100vw - 24px)',
                pointerEvents: 'auto',
                zIndex: 2147483646,
            }}
        >
            <CaptionsOff />
            <AlertTitle>AdSkip</AlertTitle>
            <div className="col-start-2 flex items-center justify-between gap-2 pt-1">
                <span className="text-sm text-muted-foreground">{text}</span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDismiss}
                    aria-label="Dismiss"
                >
                    <X className="size-4" />
                </Button>
            </div>
        </Alert>
    )
}

// Host stays in <body> so the React tree is guaranteed to render. The
// overlay/toasts use position:fixed and compute their coordinates from the
// player's bounding rect — visually anchored to the player, no DOM move
// required. On fullscreen, document.body is hidden by the fullscreen tree,
// so we re-parent the host into the fullscreen element and back.
// Inside a shadow root, :root doesn't match (it only matches <html>), so all
// the design tokens defined under :root in the compiled CSS would be missing.
// Add :host as an alias so the same variables apply to the shadow scope.
function shadowSafeStyles(css: string): string {
    return css.replace(/(^|[^.-])(:root\b)/g, '$1:host, :root')
}

function mount() {
    if (document.getElementById(ROOT_ID)) return
    const host = document.createElement('div')
    host.id = ROOT_ID
    host.style.cssText = 'all:initial;'
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const styleEl = document.createElement('style')
    styleEl.textContent = shadowSafeStyles(styles)
    shadow.appendChild(styleEl)
    const reactRoot = document.createElement('div')
    reactRoot.className = 'dark font-sans'
    shadow.appendChild(reactRoot)
    createRoot(reactRoot).render(<App />)

    document.addEventListener('fullscreenchange', () => {
        const fs = document.fullscreenElement as HTMLElement | null
        const target = fs ?? document.body
        if (host.parentElement !== target) target.appendChild(host)
    })
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import styles from '@/styles/index.css?inline'
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
            const payload = videoId ? captionsByVideo.get(videoId) : undefined
            if (!videoId || !payload) {
                sendResponse({ ok: false, error: 'No captions captured for this video yet' })
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

function App() {
    const [videoId, setVideoId] = useState<string | null>(currentVideoId)
    const [segments, setSegments] = useState<AdSegment[]>([])
    const [cancelled, setCancelled] = useState<Set<string>>(new Set())
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
        if (skip.shouldSkipTo == null || !video || !skip.activeWarning) return
        if (Math.abs(video.currentTime - skip.shouldSkipTo) < 0.5) return
        const seg = skip.activeWarning
        const seconds = Math.round((seg.endMs - seg.startMs) / 1000)
        video.currentTime = skip.shouldSkipTo
        setLastSkipped({ segId: seg.id, seconds, at: Date.now() })
    }, [skip.shouldSkipTo, video, skip.activeWarning])

    const toastVisible =
        !toastDismissed &&
        videoId !== null &&
        (captionStatus === 'unavailable' || captionStatus === 'fetch-failed')

    return (
        <>
            {skip.activeWarning && (
                <Overlay
                    segment={skip.activeWarning}
                    secondsUntilSkip={skip.secondsUntilSkip ?? 0}
                    autoSkip={settings.autoSkip}
                    onCancel={() =>
                        setCancelled(prev => {
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
                    onDismiss={() => setToastDismissed(true)}
                />
            )}
            {lastSkipped && (
                <SkippedToast
                    key={lastSkipped.at}
                    seconds={lastSkipped.seconds}
                    onDone={() => setLastSkipped(null)}
                />
            )}
        </>
    )
}

function SkippedToast({ seconds, onDone }: { seconds: number; onDone: () => void }) {
    useEffect(() => {
        const id = window.setTimeout(onDone, 5000)
        return () => clearTimeout(id)
    }, [onDone])
    return (
        <div
            className="fixed flex items-center gap-2 rounded-lg bg-emerald-600/95 px-4 py-3 text-sm font-medium text-white shadow-2xl ring-1 ring-emerald-300/30 backdrop-blur-md"
            style={{ top: 80, right: 24, pointerEvents: 'auto', zIndex: 2147483646 }}
        >
            <span aria-hidden>✓</span>
            <span>Skipped {seconds}s of sponsored content</span>
        </div>
    )
}

function PlayerToast({
    status,
    onDismiss,
}: {
    status: CaptionStatus
    onDismiss: () => void
}) {
    useEffect(() => {
        const id = window.setTimeout(onDismiss, 8000)
        return () => clearTimeout(id)
    }, [onDismiss])
    const text =
        status === 'unavailable'
            ? 'AdSkip: this video has no captions — sponsor detection isn’t possible.'
            : 'AdSkip: couldn’t fetch the caption track for this video.'
    return (
        <div
            className="fixed flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg bg-neutral-900/95 px-4 py-3 text-sm text-neutral-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
            style={{ top: 80, right: 24, pointerEvents: 'auto', zIndex: 2147483646 }}
        >
            <span>{text}</span>
            <button
                type="button"
                onClick={onDismiss}
                className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25"
            >
                Dismiss
            </button>
        </div>
    )
}

function mount() {
    if (document.getElementById(ROOT_ID)) return
    const host = document.createElement('div')
    host.id = ROOT_ID
    host.style.cssText = 'all:initial;'
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const styleEl = document.createElement('style')
    styleEl.textContent = styles
    shadow.appendChild(styleEl)
    const reactRoot = document.createElement('div')
    shadow.appendChild(reactRoot)
    createRoot(reactRoot).render(<App />)
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })

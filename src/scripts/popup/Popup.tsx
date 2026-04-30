import { useEffect, useState } from 'react'
import { DEFAULTS, getSettings, setSettings } from '@/utils/storage'
import type {
    AdSegment,
    ExtSettings,
    RuntimeMessage,
    TabState,
} from '@/content-scripts/youtube/types'

const Popup = () => {
    const [s, setS] = useState<ExtSettings>(DEFAULTS)
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [tab, setTab] = useState<TabState | null>(null)
    const [tabError, setTabError] = useState<string | null>(null)
    const [recheckBusy, setRecheckBusy] = useState(false)

    useEffect(() => {
        getSettings().then(v => {
            setS(v)
            setLoading(false)
        })
    }, [])

    useEffect(() => {
        let cancelled = false

        const poll = async () => {
            try {
                const [activeTab] = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                })
                if (!activeTab?.id || !activeTab.url?.startsWith('https://www.youtube.com/')) {
                    if (!cancelled) {
                        setTab(null)
                        setTabError('Open a YouTube video to use AdSkip.')
                    }
                    return
                }
                const state = (await chrome.tabs.sendMessage(activeTab.id, {
                    type: 'GET_STATE',
                } as RuntimeMessage)) as TabState | undefined
                if (cancelled) return
                if (!state) {
                    setTab(null)
                    setTabError('Reload the YouTube tab to activate AdSkip.')
                    return
                }
                setTab(state)
                setTabError(null)
            } catch {
                if (!cancelled) {
                    setTab(null)
                    setTabError('Reload the YouTube tab to activate AdSkip.')
                }
            }
        }

        poll()
        const id = window.setInterval(poll, 1000)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [])

    const update = <K extends keyof ExtSettings>(key: K, value: ExtSettings[K]) => {
        setS(prev => ({ ...prev, [key]: value }))
        setSettings({ [key]: value })
    }

    const test = async () => {
        setBusy(true)
        setStatus('Testing…')
        try {
            const r = (await chrome.runtime.sendMessage({ type: 'PING_OPENROUTER' })) as {
                ok: boolean
                error?: string
            }
            setStatus(r.ok ? '✓ OpenRouter reachable' : `✗ ${r.error ?? 'failed'}`)
        } catch (e) {
            setStatus(`✗ ${(e as Error).message}`)
        } finally {
            setBusy(false)
        }
    }

    const recheck = async () => {
        setRecheckBusy(true)
        try {
            const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            })
            if (!activeTab?.id) return
            const r = (await chrome.tabs.sendMessage(activeTab.id, {
                type: 'RECHECK',
            } as RuntimeMessage)) as { ok: boolean; error?: string }
            if (!r.ok) setStatus(`✗ ${r.error ?? 'recheck failed'}`)
        } catch (e) {
            setStatus(`✗ ${(e as Error).message}`)
        } finally {
            setRecheckBusy(false)
        }
    }

    if (loading) {
        return (
            <div className="w-96 bg-neutral-900 p-6 text-sm text-neutral-300">Loading…</div>
        )
    }

    return (
        <div className="w-96 space-y-4 bg-neutral-900 p-5 text-neutral-100">
            <header>
                <h1 className="text-base font-semibold">AdSkip</h1>
                <p className="text-xs text-neutral-400">
                    Detects sponsor reads in YouTube captions and skips them.
                </p>
            </header>

            <NextAdPanel
                tab={tab}
                tabError={tabError}
                onRecheck={recheck}
                recheckBusy={recheckBusy}
            />

            <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-300">
                    OpenRouter API key
                </span>
                <input
                    type="password"
                    value={s.apiKey}
                    onChange={e => update('apiKey', e.target.value)}
                    placeholder="sk-or-…"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-300">Model</span>
                <input
                    type="text"
                    value={s.model}
                    onChange={e => update('model', e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
            </label>

            <label className="flex items-center justify-between text-sm">
                <span>Auto-skip detected ads</span>
                <input
                    type="checkbox"
                    checked={s.autoSkip}
                    onChange={e => update('autoSkip', e.target.checked)}
                    className="h-4 w-4 accent-emerald-500"
                />
            </label>

            <div className="flex items-center gap-2 pt-1">
                <button
                    type="button"
                    onClick={test}
                    disabled={busy || !s.apiKey}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                    Test connection
                </button>
                {status && <span className="text-xs text-neutral-300">{status}</span>}
            </div>
        </div>
    )
}

interface NextAdPanelProps {
    tab: TabState | null
    tabError: string | null
    onRecheck: () => void
    recheckBusy: boolean
}

function NextAdPanel({ tab, tabError, onRecheck, recheckBusy }: NextAdPanelProps) {
    if (tabError) {
        return (
            <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
                {tabError}
            </div>
        )
    }
    if (!tab) return null

    const next = pickNextAd(tab.segments, tab.currentTimeMs)
    const canRecheck = tab.captionStatus === 'captured' && !recheckBusy

    return (
        <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
            <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>{tab.videoId ? `Video: ${tab.videoId}` : 'Not on a video'}</span>
                {tab.analyzing && <span className="text-amber-400">Analyzing…</span>}
            </div>

            {next ? (
                <NextAdRow segment={next} currentTimeMs={tab.currentTimeMs} />
            ) : tab.segments.length > 0 ? (
                <p className="text-xs text-emerald-400">
                    All {tab.segments.length} detected ad{tab.segments.length > 1 ? 's' : ''} are
                    behind you.
                </p>
            ) : tab.analyzing ? (
                <p className="text-xs text-neutral-400">Waiting for results…</p>
            ) : tab.captionStatus === 'captured' ? (
                <p className="text-xs text-neutral-400">No ads detected in this video.</p>
            ) : tab.captionStatus === 'unavailable' ? (
                <p className="text-xs text-rose-400">
                    This video has no captions. Ad detection isn't possible.
                </p>
            ) : tab.captionStatus === 'fetch-failed' ? (
                <p className="text-xs text-rose-400">
                    Couldn't fetch the caption track. Try Recheck after a few seconds.
                </p>
            ) : tab.captionStatus === 'fetching' ? (
                <p className="text-xs text-neutral-400">Fetching captions from YouTube…</p>
            ) : (
                <p className="text-xs text-neutral-400">
                    Waiting for YouTube to load captions…
                </p>
            )}

            <button
                type="button"
                onClick={onRecheck}
                disabled={!canRecheck}
                className="w-full rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {recheckBusy ? 'Rechecking…' : 'Recheck this video'}
            </button>
        </div>
    )
}

function NextAdRow({
    segment,
    currentTimeMs,
}: {
    segment: AdSegment
    currentTimeMs: number
}) {
    const inAd = currentTimeMs >= segment.startMs && currentTimeMs < segment.endMs
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-neutral-200">
                    {inAd ? 'Current ad' : 'Next ad'}
                </span>
                <span className="font-mono text-neutral-400">
                    {fmt(segment.startMs)}–{fmt(segment.endMs)}
                </span>
            </div>
            <p className="text-xs leading-snug text-neutral-300">{segment.summary}</p>
        </div>
    )
}

function pickNextAd(segments: AdSegment[], tMs: number): AdSegment | null {
    let inAd: AdSegment | null = null
    let upcoming: AdSegment | null = null
    for (const seg of segments) {
        if (tMs >= seg.startMs && tMs < seg.endMs) {
            inAd = seg
            break
        }
        if (tMs < seg.startMs) {
            if (!upcoming || seg.startMs < upcoming.startMs) upcoming = seg
        }
    }
    return inAd ?? upcoming
}

function fmt(ms: number) {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
}

export default Popup

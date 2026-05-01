import { useEffect, useState } from 'react'
import { Activity, Check, X, RotateCw, Megaphone, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDurationCompact } from '@/lib/utils'
import { DEFAULTS, getSettings, setSettings } from '@/utils/storage'
import { ensureHostPermission } from '@/utils/permissions'
import type {
    AdSegment,
    ExtSettings,
    RuntimeMessage,
    SkippedRecord,
    TabState,
} from '@/content-scripts/youtube/types'

const Popup = () => {
    const [s, setS] = useState<ExtSettings>(DEFAULTS)
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState<{
        text: string
        kind: 'ok' | 'err' | 'info'
    } | null>(null)
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
        setStatus({ text: 'Testing…', kind: 'info' })
        try {
            const granted = await ensureHostPermission(s.baseUrl)
            if (!granted) {
                setStatus({ text: 'Host permission denied', kind: 'err' })
                return
            }
            const r = (await chrome.runtime.sendMessage({ type: 'PING_OPENROUTER' })) as {
                ok: boolean
                error?: string
            }
            setStatus(
                r.ok
                    ? { text: 'Endpoint reachable', kind: 'ok' }
                    : { text: r.error ?? 'failed', kind: 'err' }
            )
        } catch (e) {
            setStatus({ text: (e as Error).message, kind: 'err' })
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
            if (!r.ok) setStatus({ text: r.error ?? 'recheck failed', kind: 'err' })
        } catch (e) {
            setStatus({ text: (e as Error).message, kind: 'err' })
        } finally {
            setRecheckBusy(false)
        }
    }

    if (loading) {
        return (
            <div className="dark font-sans">
                <div className="flex w-96 items-center gap-2 bg-background p-6 text-sm text-muted-foreground">
                    <Spinner />
                    Loading…
                </div>
            </div>
        )
    }

    return (
        <div className="dark font-sans">
            <div className="w-96 space-y-4 bg-background p-5 text-foreground">
                <header className="flex items-center gap-2">
                    <Megaphone className="size-5 text-foreground" />
                    <div>
                        <h1 className="text-base font-semibold leading-none">AdSkip</h1>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Detect and skip in-video sponsored segments.
                        </p>
                    </div>
                </header>

                <Tabs defaultValue="activity">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="activity">
                            <Activity className="size-3.5" />
                            Activity
                        </TabsTrigger>
                        <TabsTrigger value="settings">
                            <Settings className="size-3.5" />
                            Settings
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="activity" className="space-y-3">
                        <NextAdPanel
                            tab={tab}
                            tabError={tabError}
                            onRecheck={recheck}
                            recheckBusy={recheckBusy}
                        />
                        <StatsPanel />
                    </TabsContent>

                    <TabsContent value="settings" className="space-y-4">
                        <div className="space-y-1.5">
                            <Label
                                htmlFor="api-key"
                                className="text-xs text-muted-foreground"
                            >
                                API key
                            </Label>
                            <Input
                                id="api-key"
                                type="password"
                                value={s.apiKey}
                                onChange={e => update('apiKey', e.target.value)}
                                placeholder="sk-or-…"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="base-url"
                                className="text-xs text-muted-foreground"
                            >
                                Server URL (optional)
                            </Label>
                            <Input
                                id="base-url"
                                type="text"
                                value={s.baseUrl}
                                onChange={e => update('baseUrl', e.target.value)}
                                placeholder="https://openrouter.ai/api/v1"
                            />
                            <span className="block text-xs text-muted-foreground">
                                Any OpenAI-compatible /chat/completions endpoint.
                                Leave blank for OpenRouter.
                            </span>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="model"
                                className="text-xs text-muted-foreground"
                            >
                                Model
                            </Label>
                            <Input
                                id="model"
                                type="text"
                                value={s.model}
                                onChange={e => update('model', e.target.value)}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="auto-skip">Auto-skip detected ads</Label>
                            <Checkbox
                                id="auto-skip"
                                checked={s.autoSkip}
                                onCheckedChange={v => update('autoSkip', v === true)}
                            />
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                            <Button
                                type="button"
                                onClick={test}
                                disabled={busy || !s.apiKey}
                                size="sm"
                            >
                                {busy && (
                                    <Spinner className="size-3.5 text-primary-foreground" />
                                )}
                                Test connection
                            </Button>
                            {status && (
                                <span
                                    className={
                                        status.kind === 'err'
                                            ? 'flex items-center gap-1 text-xs text-destructive'
                                            : 'flex items-center gap-1 text-xs text-muted-foreground'
                                    }
                                >
                                    {status.kind === 'ok' && <Check className="size-3" />}
                                    {status.kind === 'err' && <X className="size-3" />}
                                    {status.text}
                                </span>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
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
            <Card>
                <CardContent className="text-xs text-muted-foreground">
                    {tabError}
                </CardContent>
            </Card>
        )
    }
    if (!tab) return null

    const next = pickNextAd(tab.segments, tab.currentTimeMs)
    const canRecheck = !recheckBusy

    return (
        <Card>
            <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">
                        {tab.videoId ? `Video: ${tab.videoId}` : 'Not on a video'}
                    </span>
                    {tab.analyzing && (
                        <span className="flex items-center gap-1 text-foreground">
                            <Spinner className="size-3 text-foreground" />
                            Analyzing
                        </span>
                    )}
                </div>

                {next ? (
                    <NextAdRow segment={next} currentTimeMs={tab.currentTimeMs} />
                ) : tab.segments.length > 0 ? (
                    <p className="text-xs text-foreground">
                        All {tab.segments.length} detected ad{tab.segments.length > 1 ? 's' : ''}{' '}
                        are behind you.
                    </p>
                ) : tab.analyzing ? (
                    <p className="text-xs text-muted-foreground">Waiting for results…</p>
                ) : tab.captionStatus === 'captured' ? (
                    <p className="text-xs text-muted-foreground">
                        No ads detected in this video.
                    </p>
                ) : tab.captionStatus === 'unavailable' ? (
                    <p className="text-xs text-destructive">
                        This video has no captions. Ad detection isn't possible.
                    </p>
                ) : tab.captionStatus === 'fetch-failed' ? (
                    <p className="text-xs text-destructive">
                        Couldn't fetch the caption track. Try Recheck after a few seconds.
                    </p>
                ) : tab.captionStatus === 'fetching' ? (
                    <p className="text-xs text-muted-foreground">
                        Fetching captions from YouTube…
                    </p>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Waiting for YouTube to load captions…
                    </p>
                )}

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onRecheck}
                    disabled={!canRecheck}
                    className="w-full"
                >
                    {recheckBusy ? (
                        <Spinner className="size-3.5" />
                    ) : (
                        <RotateCw className="size-3.5" />
                    )}
                    {recheckBusy ? 'Rechecking…' : 'Recheck this video'}
                </Button>
            </CardContent>
        </Card>
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
    const duration = formatDurationCompact(segment.endMs - segment.startMs)
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <Badge variant={inAd ? 'destructive' : 'secondary'}>
                    {inAd ? 'Current' : 'Next'}
                </Badge>
                <span className="font-mono text-muted-foreground">{duration}</span>
            </div>
            <p className="text-xs leading-snug text-muted-foreground">{segment.summary}</p>
        </div>
    )
}

function StatsPanel() {
    const [stats, setStats] = useState<{ time: number; count: number } | null>(null)

    useEffect(() => {
        const compute = (list: SkippedRecord[]) => ({
            time: list.reduce((s, r) => s + r.durationMs, 0),
            count: list.length,
        })
        const load = async () => {
            const r = (await chrome.runtime.sendMessage({
                type: 'GET_SKIP_HISTORY',
            } as RuntimeMessage)) as { history: SkippedRecord[] }
            setStats(compute(r.history ?? []))
        }
        load()
        const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
            if (changes.skipHistory) {
                setStats(compute((changes.skipHistory.newValue as SkippedRecord[]) ?? []))
            }
        }
        chrome.storage.local.onChanged.addListener(onChanged)
        return () => chrome.storage.local.onChanged.removeListener(onChanged)
    }, [])

    if (!stats || stats.count === 0) return null

    return (
        <Card>
            <CardContent className="flex items-center justify-between">
                <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Time saved
                    </div>
                    <div className="text-lg font-semibold tabular-nums">
                        {formatDurationCompact(stats.time)}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Skipped
                    </div>
                    <div className="text-lg font-semibold tabular-nums">
                        {stats.count}
                    </div>
                </div>
            </CardContent>
        </Card>
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

export default Popup

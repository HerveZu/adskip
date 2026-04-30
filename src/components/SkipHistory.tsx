import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatDurationCompact } from '@/lib/utils'
import type { RuntimeMessage, SkippedRecord } from '@/content-scripts/youtube/types'

interface Props {
    limit?: number
    showClear?: boolean
}

export function SkipHistory({ limit, showClear = false }: Props) {
    const [history, setHistory] = useState<SkippedRecord[] | null>(null)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const r = (await chrome.runtime.sendMessage({
                type: 'GET_SKIP_HISTORY',
            } as RuntimeMessage)) as { history: SkippedRecord[] }
            if (!cancelled) setHistory(r.history ?? [])
        }
        load()
        const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
            if (changes.skipHistory) {
                setHistory((changes.skipHistory.newValue as SkippedRecord[]) ?? [])
            }
        }
        chrome.storage.local.onChanged.addListener(onChanged)
        return () => {
            cancelled = true
            chrome.storage.local.onChanged.removeListener(onChanged)
        }
    }, [])

    const clear = async () => {
        await chrome.runtime.sendMessage({
            type: 'CLEAR_SKIP_HISTORY',
        } as RuntimeMessage)
    }

    if (history === null) {
        return (
            <Card>
                <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    Loading history…
                </CardContent>
            </Card>
        )
    }

    const totalMs = history.reduce((s, r) => s + r.durationMs, 0)
    const visible = limit ? history.slice(0, limit) : history

    return (
        <div className="space-y-2">
            <Card>
                <CardContent className="flex items-center justify-between">
                    <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Time saved
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                            {formatDurationCompact(totalMs)}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Sponsors skipped
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                            {history.length}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {visible.length === 0 ? (
                <Card>
                    <CardContent className="text-xs text-muted-foreground">
                        No skips yet — let an ad hit and we'll record it here.
                    </CardContent>
                </Card>
            ) : (
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {visible.map(r => (
                        <SkipRow key={r.id} record={r} />
                    ))}
                </div>
            )}

            {showClear && history.length > 0 && (
                <Button variant="secondary" size="sm" onClick={clear}>
                    <Trash2 className="size-3.5" />
                    Clear history
                </Button>
            )}
        </div>
    )
}

function SkipRow({ record }: { record: SkippedRecord }) {
    const ago = formatDistanceToNow(record.skippedAt, { addSuffix: true })
    const url = `https://www.youtube.com/watch?v=${record.videoId}`
    return (
        <Card className="border-border/60">
            <CardContent className="space-y-1 p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs font-medium text-foreground hover:underline"
                        title={record.videoTitle}
                    >
                        {record.videoTitle || record.videoId}
                    </a>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatDurationCompact(record.durationMs)}
                    </span>
                </div>
                {record.summary && (
                    <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                        {record.summary}
                    </p>
                )}
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {ago}
                </div>
            </CardContent>
        </Card>
    )
}

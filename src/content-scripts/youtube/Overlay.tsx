import { useEffect, useRef } from 'react'
import { Megaphone } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDurationCompact } from '@/lib/utils'
import type { AdSegment } from './types'

interface Props {
    segment: AdSegment
    secondsUntilSkip: number
    autoSkip: boolean
    playerRect: DOMRect | null
    onCancel: () => void
    onDismiss: () => void
}

const AUTO_DISMISS_MS = 5_000

export default function Overlay({
    segment,
    secondsUntilSkip,
    autoSkip,
    playerRect,
    onCancel,
    onDismiss,
}: Props) {
    const onDismissRef = useRef(onDismiss)
    useEffect(() => {
        onDismissRef.current = onDismiss
    })
    useEffect(() => {
        const id = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS)
        return () => clearTimeout(id)
    }, [])

    const top = playerRect ? Math.max(8, playerRect.top + 12) : 80
    const right = playerRect
        ? Math.max(8, window.innerWidth - playerRect.right + 12)
        : 24
    const duration = formatDurationCompact(segment.endMs - segment.startMs)
    const headline =
        autoSkip && secondsUntilSkip > 0
            ? `Sponsor · skip in ${secondsUntilSkip}s`
            : autoSkip
              ? 'Sponsor · skipping…'
              : 'Sponsor detected'

    return (
        <Alert
            variant="destructive"
            className="shadow-lg"
            style={{
                position: 'fixed',
                top,
                right,
                width: 320,
                maxWidth: 'calc(100vw - 24px)',
                pointerEvents: 'auto',
                zIndex: 2147483646,
            }}
        >
            <Megaphone />
            <AlertTitle>{headline}</AlertTitle>
            <AlertDescription>
                <p className="text-card-foreground">{segment.summary}</p>
                <div className="flex w-full items-center justify-between gap-2 pt-1">
                    <span className="font-mono text-xs text-muted-foreground">
                        {duration}
                    </span>
                    {autoSkip && (
                        <Button variant="secondary" size="sm" onClick={onCancel}>
                            Don't skip
                        </Button>
                    )}
                </div>
            </AlertDescription>
        </Alert>
    )
}

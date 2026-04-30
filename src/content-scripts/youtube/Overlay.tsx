import type { AdSegment } from './types'

interface Props {
    segment: AdSegment
    secondsUntilSkip: number
    autoSkip: boolean
    onCancel: () => void
}

export default function Overlay({ segment, secondsUntilSkip, autoSkip, onCancel }: Props) {
    return (
        <div
            className="fixed w-[420px] max-w-[calc(100vw-2rem)] rounded-xl bg-neutral-900/95 p-5 text-base text-neutral-50 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
            style={{ top: 80, right: 24, pointerEvents: 'auto', zIndex: 2147483646 }}
        >
            <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full bg-rose-500/90 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                    Ad detected
                </span>
                {autoSkip && secondsUntilSkip > 0 && (
                    <span className="text-base font-semibold text-neutral-200">
                        Skipping in {secondsUntilSkip}s
                    </span>
                )}
                {autoSkip && secondsUntilSkip === 0 && (
                    <span className="text-base font-semibold text-emerald-400">
                        Skipping…
                    </span>
                )}
            </div>
            <p className="mb-4 leading-snug text-neutral-50">{segment.summary}</p>
            <div className="flex items-center justify-between gap-3 text-sm text-neutral-400">
                <span className="font-mono">
                    {fmt(segment.startMs)} – {fmt(segment.endMs)}
                </span>
                {autoSkip && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-md bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
                    >
                        Don't skip
                    </button>
                )}
            </div>
        </div>
    )
}

function fmt(ms: number) {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
}

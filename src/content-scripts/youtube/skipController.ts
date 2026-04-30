import type { AdSegment } from './types'

export interface SkipState {
    activeWarning?: AdSegment
    secondsUntilSkip?: number
    shouldSkipTo?: number
}

export interface SkipInputs {
    segments: AdSegment[]
    timeMs: number
    cancelled: Set<string>
    autoSkip: boolean
    prerollSeconds: number
}

export function computeSkipState({
    segments,
    timeMs,
    cancelled,
    autoSkip,
    prerollSeconds,
}: SkipInputs): SkipState {
    const prerollMs = prerollSeconds * 1000
    const out: SkipState = {}

    for (const seg of segments) {
        if (cancelled.has(seg.id)) continue

        if (timeMs >= seg.startMs && timeMs < seg.endMs) {
            if (autoSkip) {
                out.shouldSkipTo = seg.endMs / 1000 + 0.05
            }
            out.activeWarning = seg
            out.secondsUntilSkip = 0
            return out
        }

        if (timeMs >= seg.startMs - prerollMs && timeMs < seg.startMs) {
            out.activeWarning = seg
            out.secondsUntilSkip = Math.max(
                0,
                Math.ceil((seg.startMs - timeMs) / 1000)
            )
            return out
        }
    }

    return out
}

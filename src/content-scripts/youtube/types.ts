export interface CaptionSeg {
    utf8?: string
}

export interface CaptionEvent {
    tStartMs: number
    dDurationMs?: number
    segs?: CaptionSeg[]
}

export interface CaptionPayload {
    events?: CaptionEvent[]
    [k: string]: unknown
}

export interface AdSegment {
    id: string
    startMs: number
    endMs: number
    summary: string
}

export interface ExtSettings {
    apiKey: string
    model: string
    autoSkip: boolean
    prerollSeconds: number
}

export type RuntimeMessage =
    | { type: 'ANALYZE_CAPTIONS'; videoId: string; payload: CaptionPayload; force?: boolean }
    | { type: 'PING_OPENROUTER' }
    | { type: 'AD_SEGMENTS'; videoId: string; segments: AdSegment[] }
    | { type: 'CLEAR_CACHE' }
    | { type: 'GET_STATE' }
    | { type: 'RECHECK' }

export type CaptionStatus =
    | 'pending'
    | 'fetching'
    | 'captured'
    | 'unavailable'
    | 'fetch-failed'

export interface TabState {
    videoId: string | null
    currentTimeMs: number
    captionStatus: CaptionStatus
    analyzing: boolean
    segments: AdSegment[]
}

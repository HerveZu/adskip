import type {
    AdSegment,
    CaptionEvent,
    CaptionPayload,
} from '@/content-scripts/youtube/types'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

const SYSTEM_PROMPT = `You detect in-video sponsor reads, promotional segments, and self-promotion in YouTube transcripts.
Return STRICT JSON of the form:
{"segments":[{"startMs":<int>,"endMs":<int>,"summary":"<<=140 chars>"}]}
Rules:
- Use the timestamps that appear in the input.
- A segment must be a single contiguous block of captions that constitutes a sponsor / paid promo / merch / Patreon / channel-promo read.
- Do NOT flag normal editorial content, even if it mentions a brand.
- summary: one short sentence describing what is being advertised.
- If there are none, return {"segments":[]}.
- Output ONLY the JSON object, no prose, no code fences.`

interface RouterCallOpts {
    apiKey: string
    model: string
    signal?: AbortSignal
}

export async function analyzeCaptions(
    payload: CaptionPayload,
    opts: RouterCallOpts
): Promise<AdSegment[]> {
    const lines = (payload.events ?? [])
        .map(formatEvent)
        .filter((s): s is string => Boolean(s))
    if (lines.length === 0) return []

    const body = {
        model: opts.model,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: lines.join('\n') },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    }

    const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: opts.signal,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
            'HTTP-Referer': chrome.runtime.getURL(''),
            'X-Title': 'AdSkip',
        },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`)
    }
    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content ?? '{}'
    const parsed = safeParseJson(content)
    const raw = Array.isArray(parsed?.segments) ? parsed.segments : []
    return raw
        .map(normalizeSegment)
        .filter((s): s is AdSegment => s !== null)
        .sort((a, b) => a.startMs - b.startMs)
}

export async function pingOpenRouter(opts: RouterCallOpts): Promise<boolean> {
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: opts.signal,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
            'HTTP-Referer': chrome.runtime.getURL(''),
            'X-Title': 'AdSkip',
        },
        body: JSON.stringify({
            model: opts.model,
            messages: [{ role: 'user', content: 'pong' }],
            max_tokens: 1,
        }),
    })
    if (res.ok) return true
    const txt = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`)
}

function formatEvent(ev: CaptionEvent): string | null {
    const text =
        ev.segs
            ?.map(s => s.utf8 ?? '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim() ?? ''
    if (!text) return null
    const start = ev.tStartMs
    const end = start + (ev.dDurationMs ?? 0)
    return `[${start}-${end}] ${text}`
}

function safeParseJson(s: string): { segments?: unknown } {
    try {
        return JSON.parse(s)
    } catch {
        const m = s.match(/\{[\s\S]*\}/)
        if (!m) return {}
        try {
            return JSON.parse(m[0])
        } catch {
            return {}
        }
    }
}

function normalizeSegment(raw: unknown): AdSegment | null {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as { startMs?: unknown; endMs?: unknown; summary?: unknown }
    const startMs = Number(r.startMs)
    const endMs = Number(r.endMs)
    const summary = typeof r.summary === 'string' ? r.summary : ''
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
    if (endMs <= startMs) return null
    return {
        id: `${startMs}-${endMs}`,
        startMs: Math.max(0, Math.floor(startMs)),
        endMs: Math.floor(endMs),
        summary: summary.slice(0, 200),
    }
}

import type {
    AdSegment,
    CaptionPayload,
    RuntimeMessage,
} from '@/content-scripts/youtube/types'
import { getSettings } from '@/utils/storage'
import { analyzeCaptions, pingOpenRouter } from '@/utils/openrouter'

const TAG = '[adskip:bg]'

console.log(TAG, 'service worker loaded')

const inflight = new Map<string, Promise<AdSegment[]>>()

chrome.runtime.onInstalled.addListener(() => {
    console.log(TAG, 'installed')
})

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
    if (msg.type === 'ANALYZE_CAPTIONS') {
        handleAnalyze(msg.videoId, msg.payload, sender.tab?.id, msg.force === true)
            .then(segments => sendResponse({ ok: true, segments }))
            .catch(err => {
                console.warn(TAG, 'analyze failed', err)
                sendResponse({ ok: false, error: String(err?.message ?? err) })
            })
        return true
    }
    if (msg.type === 'PING_OPENROUTER') {
        ;(async () => {
            try {
                const settings = await getSettings()
                if (!settings.apiKey) throw new Error('No API key set')
                await pingOpenRouter({ apiKey: settings.apiKey, model: settings.model })
                sendResponse({ ok: true })
            } catch (err) {
                sendResponse({ ok: false, error: String((err as Error)?.message ?? err) })
            }
        })()
        return true
    }
    if (msg.type === 'CLEAR_CACHE') {
        chrome.storage.session.clear().then(() => sendResponse({ ok: true }))
        return true
    }
})

chrome.commands?.onCommand.addListener(command => {
    if (command === 'refresh_extension') chrome.runtime.reload()
})

async function handleAnalyze(
    videoId: string,
    payload: CaptionPayload,
    tabId: number | undefined,
    force: boolean
): Promise<AdSegment[]> {
    const cacheKey = `segments:${videoId}`

    if (force) {
        await chrome.storage.session.remove(cacheKey)
        inflight.delete(videoId)
    } else {
        const cached = (await chrome.storage.session.get(cacheKey)) as Record<
            string,
            AdSegment[] | undefined
        >
        if (cached[cacheKey]) {
            const segs = cached[cacheKey]!
            broadcast(tabId, videoId, segs)
            return segs
        }

        if (inflight.has(videoId)) {
            const segs = await inflight.get(videoId)!
            broadcast(tabId, videoId, segs)
            return segs
        }
    }

    const settings = await getSettings()
    if (!settings.apiKey) {
        console.warn(TAG, 'no API key — skipping analysis')
        return []
    }

    const promise = analyzeCaptions(payload, {
        apiKey: settings.apiKey,
        model: settings.model,
    })
    inflight.set(videoId, promise)
    try {
        const segs = await promise
        await chrome.storage.session.set({ [cacheKey]: segs })
        broadcast(tabId, videoId, segs)
        return segs
    } finally {
        inflight.delete(videoId)
    }
}

function broadcast(tabId: number | undefined, videoId: string, segments: AdSegment[]) {
    if (tabId == null) return
    chrome.tabs
        .sendMessage(tabId, { type: 'AD_SEGMENTS', videoId, segments } as RuntimeMessage)
        .catch(() => {
            /* tab may have navigated — ignore */
        })
}

export {}

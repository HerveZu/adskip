import type { ExtSettings, SkippedRecord } from '@/content-scripts/youtube/types'

export const DEFAULTS: ExtSettings = {
    apiKey: '',
    model: 'google/gemini-3-flash-preview',
    autoSkip: true,
    prerollSeconds: 10,
}

export async function getSettings(): Promise<ExtSettings> {
    const keys = Object.keys(DEFAULTS) as Array<keyof ExtSettings>
    const raw = (await chrome.storage.local.get(keys)) as Partial<ExtSettings>
    return { ...DEFAULTS, ...raw }
}

export async function setSettings(patch: Partial<ExtSettings>): Promise<void> {
    await chrome.storage.local.set(patch)
}

const SKIP_HISTORY_KEY = 'skipHistory'
const MAX_RECORDS = 200

export async function recordSkip(record: SkippedRecord): Promise<void> {
    const data = await chrome.storage.local.get(SKIP_HISTORY_KEY)
    const list = (data[SKIP_HISTORY_KEY] as SkippedRecord[] | undefined) ?? []
    if (list.some(r => r.id === record.id)) return
    list.unshift(record)
    if (list.length > MAX_RECORDS) list.length = MAX_RECORDS
    await chrome.storage.local.set({ [SKIP_HISTORY_KEY]: list })
}

export async function getSkipHistory(): Promise<SkippedRecord[]> {
    const data = await chrome.storage.local.get(SKIP_HISTORY_KEY)
    return (data[SKIP_HISTORY_KEY] as SkippedRecord[] | undefined) ?? []
}

export async function clearSkipHistory(): Promise<void> {
    await chrome.storage.local.remove(SKIP_HISTORY_KEY)
}

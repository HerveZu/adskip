import type { ExtSettings } from '@/content-scripts/youtube/types'

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

import { useEffect, useState } from 'react'
import { DEFAULTS, getSettings, setSettings } from '@/utils/storage'
import type { ExtSettings } from '@/content-scripts/youtube/types'

const Options = () => {
    const [s, setS] = useState<ExtSettings>(DEFAULTS)
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState<string | null>(null)

    useEffect(() => {
        getSettings().then(v => {
            setS(v)
            setLoading(false)
        })
    }, [])

    const update = <K extends keyof ExtSettings>(key: K, value: ExtSettings[K]) => {
        setS(prev => ({ ...prev, [key]: value }))
        setSettings({ [key]: value })
    }

    const clearCache = async () => {
        await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' })
        setStatus('Session cache cleared')
        setTimeout(() => setStatus(null), 2000)
    }

    if (loading) return <div className="p-8 text-neutral-300">Loading…</div>

    return (
        <div className="mx-auto max-w-xl space-y-6 bg-neutral-950 p-8 text-neutral-100">
            <header>
                <h1 className="text-xl font-semibold">AdSkip — Settings</h1>
                <p className="text-sm text-neutral-400">
                    Stored locally in this browser via chrome.storage.local.
                </p>
            </header>

            <label className="block space-y-1">
                <span className="text-sm font-medium">OpenRouter API key</span>
                <input
                    type="password"
                    value={s.apiKey}
                    onChange={e => update('apiKey', e.target.value)}
                    placeholder="sk-or-…"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-sm font-medium">Model</span>
                <input
                    type="text"
                    value={s.model}
                    onChange={e => update('model', e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-sm font-medium">Pre-roll seconds</span>
                <input
                    type="number"
                    min={0}
                    max={30}
                    value={s.prerollSeconds}
                    onChange={e =>
                        update('prerollSeconds', Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="block text-xs text-neutral-400">
                    How long the warning shows before the skip fires.
                </span>
            </label>

            <label className="flex items-center justify-between">
                <span className="text-sm font-medium">Auto-skip detected ads</span>
                <input
                    type="checkbox"
                    checked={s.autoSkip}
                    onChange={e => update('autoSkip', e.target.checked)}
                    className="h-5 w-5 accent-emerald-500"
                />
            </label>

            <div className="flex items-center gap-3 pt-2">
                <button
                    type="button"
                    onClick={clearCache}
                    className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-700"
                >
                    Clear cached segments
                </button>
                {status && <span className="text-sm text-emerald-400">{status}</span>}
            </div>
        </div>
    )
}

export default Options

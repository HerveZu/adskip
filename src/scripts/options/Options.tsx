import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
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

    if (loading) {
        return (
            <div className="dark font-sans min-h-screen bg-background">
                <div className="flex items-center gap-2 p-8 text-muted-foreground">
                    <Spinner />
                    Loading…
                </div>
            </div>
        )
    }

    return (
        <div className="dark font-sans min-h-screen bg-background">
            <div className="mx-auto max-w-xl space-y-6 p-8 text-foreground">
                <header>
                    <h1 className="text-xl font-semibold">AdSkip — Settings</h1>
                    <p className="text-sm text-muted-foreground">
                        Stored locally in this browser via chrome.storage.local.
                    </p>
                </header>

                <div className="space-y-1.5">
                    <Label htmlFor="opt-api-key">API key</Label>
                    <Input
                        id="opt-api-key"
                        type="password"
                        value={s.apiKey}
                        onChange={e => update('apiKey', e.target.value)}
                        placeholder="sk-or-…"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="opt-base-url">Server URL (optional)</Label>
                    <Input
                        id="opt-base-url"
                        type="text"
                        value={s.baseUrl}
                        onChange={e => update('baseUrl', e.target.value)}
                        placeholder="https://openrouter.ai/api/v1"
                    />
                    <span className="block text-xs text-muted-foreground">
                        Any OpenAI-compatible /chat/completions endpoint.
                        Leave blank for OpenRouter.
                    </span>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="opt-model">Model</Label>
                    <Input
                        id="opt-model"
                        type="text"
                        value={s.model}
                        onChange={e => update('model', e.target.value)}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="opt-preroll">Pre-roll seconds</Label>
                    <Input
                        id="opt-preroll"
                        type="number"
                        min={0}
                        max={30}
                        value={s.prerollSeconds}
                        onChange={e =>
                            update('prerollSeconds', Math.max(0, Number(e.target.value) || 0))
                        }
                        className="w-32"
                    />
                    <span className="block text-xs text-muted-foreground">
                        How long the warning shows before the skip fires.
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <Label htmlFor="opt-auto-skip">Auto-skip detected ads</Label>
                    <Checkbox
                        id="opt-auto-skip"
                        checked={s.autoSkip}
                        onCheckedChange={v => update('autoSkip', v === true)}
                    />
                </div>

                <div className="flex items-center gap-3 pt-2">
                    <Button variant="secondary" onClick={clearCache}>
                        <Trash2 className="size-4" />
                        Clear cached segments
                    </Button>
                    {status && <span className="text-sm text-foreground">{status}</span>}
                </div>
            </div>
        </div>
    )
}

export default Options

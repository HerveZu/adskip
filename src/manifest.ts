import fs from 'node:fs'
import path from 'node:path'

interface ContentScriptConfig {
    matches: string[]
    run_at?: 'document_start' | 'document_end' | 'document_idle'
    all_frames?: boolean
}

interface Manifest {
    manifest_version: number
    name: string
    version: string
    description: string
    action: { default_popup: string }
    options_ui: { page: string; open_in_tab: boolean }
    background: { service_worker: string; type: string }
    icons: Record<string, string>
    permissions: string[]
    host_permissions?: string[]
    optional_host_permissions?: string[]
    content_scripts: Array<{
        matches: string[]
        js: string[]
        run_at?: string
        all_frames?: boolean
        world?: 'ISOLATED' | 'MAIN'
    }>
    web_accessible_resources?: Array<{ matches: string[]; resources: string[] }>
    commands?: Record<
        string,
        {
            suggested_key: { default: string; mac?: string }
            description: string
        }
    >
}

type ContentScriptEntry = {
    matches: string[]
    js: string[]
    run_at?: string
    all_frames?: boolean
    world?: 'ISOLATED' | 'MAIN'
}

function discoverContentScripts(): ContentScriptEntry[] {
    const contentDir = path.resolve('src/content-scripts')
    if (!fs.existsSync(contentDir)) return []

    const entries: ContentScriptEntry[] = []

    for (const d of fs.readdirSync(contentDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        const folder = path.join(contentDir, d.name)
        if (!fs.existsSync(path.join(folder, 'index.tsx'))) continue

        const configPath = path.join(folder, 'config.json')
        const config: ContentScriptConfig = fs.existsSync(configPath)
            ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
            : { matches: ['<all_urls>'] }

        const isolated: ContentScriptEntry = {
            matches: config.matches,
            js: [`js/content-${d.name}.js`],
        }
        if (config.run_at) isolated.run_at = config.run_at
        if (config.all_frames) isolated.all_frames = config.all_frames
        entries.push(isolated)
    }

    return entries
}

function createManifest(): Manifest {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'))

    return {
        manifest_version: 3,
        name: pkg.longName ?? pkg.name ?? 'My Extension',
        version: pkg.version,
        description: pkg.description ?? '',
        action: {
            default_popup: 'src/scripts/popup/popup.html',
        },
        options_ui: {
            page: 'src/scripts/options/options.html',
            open_in_tab: true,
        },
        background: {
            service_worker: 'js/service-worker.js',
            type: 'module',
        },
        icons: {
            '16': 'assets/icon-16.png',
            '48': 'assets/icon-48.png',
            '128': 'assets/icon-128.png',
        },
        permissions: ['storage', 'scripting'],
        host_permissions: [
            'https://www.youtube.com/*',
            'https://openrouter.ai/*',
        ],
        // Custom server URLs are granted at runtime via chrome.permissions.request
        // when the user clicks Test connection. Declared here so the API call
        // is allowed at all; not requested at install time.
        optional_host_permissions: ['https://*/*', 'http://*/*'],
        content_scripts: discoverContentScripts(),
        web_accessible_resources: [
            {
                matches: ['https://www.youtube.com/*'],
                resources: ['js/inject.js'],
            },
        ],
        commands: {
            refresh_extension: {
                suggested_key: { default: 'Ctrl+Space' },
                description: 'Refresh Extension',
            },
        },
    }
}

export async function writeManifest(): Promise<void> {
    const manifest = createManifest()
    fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2))
    console.log('manifest.json generated')
}

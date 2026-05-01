// Custom server URLs aren't covered by the static host_permissions in the
// manifest, but optional_host_permissions lets us request them at runtime.
// Empty baseUrl means OpenRouter, which is already in host_permissions.
export async function ensureHostPermission(baseUrl: string): Promise<boolean> {
    if (!baseUrl?.trim()) return true
    let origin: string
    try {
        const u = new URL(baseUrl)
        origin = `${u.protocol}//${u.host}/*`
    } catch {
        return false
    }
    const has = await chrome.permissions.contains({ origins: [origin] })
    if (has) return true
    // Must be called from a user-gesture handler (button click).
    return chrome.permissions.request({ origins: [origin] })
}

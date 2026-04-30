import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { intervalToDuration } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatDurationCompact(ms: number): string {
    const safe = Math.max(0, Math.round(ms))
    const dur = intervalToDuration({ start: 0, end: safe })
    const parts: string[] = []
    if (dur.hours) parts.push(`${dur.hours}h`)
    if (dur.minutes) parts.push(`${dur.minutes}m`)
    if (dur.seconds || parts.length === 0) parts.push(`${dur.seconds ?? 0}s`)
    return parts.join('')
}

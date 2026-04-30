import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpinnerProps extends React.HTMLAttributes<SVGSVGElement> {
    label?: string
}

export function Spinner({ className, label = 'Loading…', ...props }: SpinnerProps) {
    return (
        <Loader2
            role="status"
            aria-label={label}
            className={cn('size-4 animate-spin text-muted-foreground', className)}
            {...props}
        />
    )
}

import { Loader2 } from 'lucide-react'

export function ActionStatus({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex justify-center px-4"
    >
      <div className="flex items-center gap-2 rounded-full border bg-popover px-3.5 py-2 text-sm font-medium text-foreground shadow-lg">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {message}
      </div>
    </div>
  )
}

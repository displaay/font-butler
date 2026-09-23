import { Loader2 } from 'lucide-react'

export type ActionStatusAction = { label: string; onClick: () => void }

export function ActionStatus({ message, action }: { message: string | null; action?: ActionStatusAction }) {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex justify-center px-4">
      <div
        className={`group flex items-center gap-2 rounded-full border bg-popover px-3.5 py-2 text-sm font-medium text-foreground shadow-lg [transform:translateZ(0)] ${action ? 'pointer-events-auto' : ''}`}
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        <span role="status" aria-live="polite">
          {message}
        </span>
        {action ? (
          // Hover or keyboard focus reveals it; it stays in the tab order the whole time.
          <button
            type="button"
            onClick={action.onClick}
            className="-my-1 -mr-2 max-w-0 overflow-hidden whitespace-nowrap rounded-full px-0 py-1 text-[13px] font-medium text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:max-w-40 focus-visible:px-2.5 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:max-w-40 group-hover:px-2.5 group-hover:opacity-100"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}

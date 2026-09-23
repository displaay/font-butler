import { Loader2 } from 'lucide-react'

export type ActionStatusAction = { label: string; onClick: () => void }

export function ActionStatus({ message, action }: { message: string | null; action?: ActionStatusAction }) {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex justify-center px-4">
      <div
        className={`action-status-pill flex items-center gap-2 rounded-full border bg-popover px-3.5 py-2 text-sm font-medium text-foreground shadow-lg [transform:translateZ(0)] ${action ? 'pointer-events-auto' : ''}`}
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        <span role="status" aria-live="polite">
          {message}
        </span>
        {action ? (
          // Hover or keyboard focus expands the pill; the button stays in the tab order.
          <span className="action-status-reveal">
            <button
              type="button"
              onClick={action.onClick}
              className="action-status-action rounded-full px-2.5 py-0.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {action.label}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  )
}

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ActivationSwitchPosition } from '@/lib/activationSwitch'
import { cn } from '@/lib/utils'

/**
 * Cicero's MiniSwitch: a 26×15 capsule, white knob, quaternary track when off,
 * tint when on. Always drawn by the card; it does not wait for hover.
 */
export function ActivationSwitch({
  position,
  enabled,
  busy = false,
  help,
  onToggle,
}: {
  position: ActivationSwitchPosition
  enabled: boolean
  busy?: boolean
  help: string
  onToggle: () => void
}) {
  const interactive = enabled && !busy
  const checked = position === 'on' ? true : position === 'app' ? 'mixed' : false
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Active"
          title={help}
          data-no-marquee=""
          data-activation-switch=""
          data-position={position}
          disabled={!interactive}
          className={cn(
            'cuttler-activation-switch relative shrink-0 rounded-full p-[1.5px] outline-none',
            'transition-opacity duration-150 ease-out',
            !interactive && 'cursor-default opacity-45',
          )}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (interactive) onToggle()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <span
            aria-hidden
            className={cn(
              'block size-3 rounded-full bg-white shadow-[0_0.5px_0.5px_rgba(0,0,0,0.25)]',
              'transition-transform duration-150 ease-out',
              position === 'off' && 'translate-x-0',
              position === 'app' && 'translate-x-[5.5px]',
              position === 'on' && 'translate-x-[11px]',
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  )
}

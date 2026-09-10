import { type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn, CONTROL_H } from '@/lib/utils'

/** Selects in Settings: same height and type size as other settings controls. */
export const settingsSelectClass = cn(
  CONTROL_H,
  'w-auto min-w-[9.5rem] max-w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
)

export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  extra,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  children?: ReactNode
  extra?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 py-3.5',
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium leading-5 text-foreground">
            {label}
          </Label>
        ) : (
          <div className="text-sm font-medium leading-5 text-foreground">{label}</div>
        )}
        {description ? (
          <div className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children != null ? (
        <div className="flex items-center justify-end self-center">{children}</div>
      ) : null}
      {extra ? <div className="col-span-2 min-w-0">{extra}</div> : null}
    </div>
  )
}

export function SettingsSection({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(title ? 'mt-6 first:mt-0' : undefined, className)}>
      {title ? (
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">{title}</h3>
      ) : null}
      <div className={cn('divide-y divide-border', title && 'mt-0.5')}>{children}</div>
    </section>
  )
}

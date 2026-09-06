import { type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

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
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-3.5',
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
      </div>
      {children != null ? (
        <div className="col-start-2 row-start-1 flex items-center justify-end">{children}</div>
      ) : null}
      {description ? (
        <div className="col-start-1 min-w-0 text-[13px] leading-5 text-muted-foreground">
          {description}
        </div>
      ) : null}
      {extra ? <div className="col-span-2 min-w-0 pt-1.5">{extra}</div> : null}
    </div>
  )
}

export function SettingsSection({
  title,
  children,
  className,
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(title ? 'mt-6 first:mt-0' : undefined, className)}>
      {title ? <h3 className="text-sm font-medium text-foreground">{title}</h3> : null}
      <div className={cn('divide-y divide-border', title && 'mt-0.5')}>{children}</div>
    </section>
  )
}

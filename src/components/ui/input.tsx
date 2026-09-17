import { useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-8 w-full appearance-none rounded-md border bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30',
        className,
      )}
      {...props}
    />
  )
}

function PasswordInput({
  className,
  disabled,
  onReveal,
  ...props
}: ComponentProps<'input'> & {
  onReveal?: () => Promise<void> | void
}) {
  const [visible, setVisible] = useState(false)

  async function toggle() {
    if (disabled) return
    if (visible) {
      setVisible(false)
      return
    }
    setVisible(true)
    if (!String(props.value ?? '') && onReveal) {
      try {
        await onReveal()
      } catch {
        // Caller surfaces fetch errors; the field still switches to text.
      }
    }
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <Input
        {...props}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        className="pr-8"
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? 'Hide token' : 'Show token'}
        aria-pressed={visible}
        className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 cursor-default items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5"
        onClick={() => void toggle()}
      >
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </div>
  )
}

export { Input, PasswordInput }

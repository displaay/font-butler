import { Toaster as Sonner } from 'sonner'
import 'sonner/dist/styles.css'
import type { CSSProperties } from 'react'
import type { ThemeMode } from '@/lib/types'

function Toaster({ theme = 'system' }: { theme?: ThemeMode }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      duration={4000}
      visibleToasts={3}
      gap={8}
      offset={28}
      toastOptions={{
        className: 'font-butler-toast',
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--popover)',
          '--success-text': 'var(--popover-foreground)',
          '--success-border': 'var(--border)',
          '--error-bg': 'var(--popover)',
          '--error-text': 'var(--popover-foreground)',
          '--error-border': 'var(--destructive)',
        } as CSSProperties
      }
    />
  )
}

export { Toaster }

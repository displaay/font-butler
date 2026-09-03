import { Toaster as Sonner } from 'sonner'

function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        className: 'border-border bg-card text-foreground shadow-lg',
      }}
    />
  )
}

export { Toaster }

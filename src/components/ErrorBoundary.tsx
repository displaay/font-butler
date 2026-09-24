import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Font Buttler UI error', error, info.componentStack)
  }

  private resetViewSettings = () => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('font-butler-') || key.startsWith('fontcase-')) {
          localStorage.removeItem(key)
        }
      }
    } catch {
      // ignore
    }
    window.location.reload()
  }

  private copyDetails = async () => {
    const { error } = this.state
    if (!error) return
    const text = `${error.name}: ${error.message}\n${error.stack ?? ''}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      console.error(text)
    }
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-lg text-center text-sm text-muted-foreground">{error.message}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            onClick={() => this.resetViewSettings()}
          >
            Reset view settings
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            onClick={() => void this.copyDetails()}
          >
            Copy details
          </button>
        </div>
      </div>
    )
  }
}

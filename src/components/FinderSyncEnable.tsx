import { Button } from '@/components/ui/button'
import {
  FINDER_SYNC_ENABLE_DESCRIPTION,
  FINDER_SYNC_ENABLE_LABEL,
  FINDER_SYNC_SETTINGS_BUTTON,
} from '@/lib/finderSync'

function openFinderExtensionsSettings() {
  void window.fontButlerDesktop?.openFinderExtensions?.()
}

export function FinderSyncEnableButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={openFinderExtensionsSettings}
    >
      {FINDER_SYNC_SETTINGS_BUTTON}
    </Button>
  )
}

export function FinderSyncEnableNote({ disabled = false }: { disabled?: boolean }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{FINDER_SYNC_ENABLE_LABEL}</p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{FINDER_SYNC_ENABLE_DESCRIPTION}</p>
      <div className="mt-3">
        <FinderSyncEnableButton disabled={disabled} />
      </div>
    </div>
  )
}

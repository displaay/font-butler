import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { appIconPreviewSrc, type AppIconStyle } from '@/lib/appIcon'
import { cn } from '@/lib/utils'
import type { Announcement } from '../../shared/announcements.ts'

const RENAME_ANNOUNCEMENT_ID = 'rename-to-cuttler'
const CUTTLER_ICON: AppIconStyle = 'cuttler'

/**
 * Product announcement dialog — same visual language as Welcome onboarding
 * (shared Dialog tokens: popover surface, title, muted description, primary CTA).
 */
export function AnnouncementDialog({
  announcement,
  open,
  onDismiss,
  currentIcon = null,
  onSelectIcon,
}: {
  announcement: Announcement | null
  open: boolean
  onDismiss: (announcement: Announcement) => void
  /** Null until settings have loaded, so the old icon is not guessed. */
  currentIcon?: AppIconStyle | null
  onSelectIcon?: (style: AppIconStyle) => Promise<void> | void
}) {
  const item = announcement
  const dismissedRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const resetKey = `${open}:${item?.id ?? ''}`
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setSaving(false)
  }
  const offersIconChoice = item?.id === RENAME_ANNOUNCEMENT_ID

  useEffect(() => {
    if (open) dismissedRef.current = false
  }, [open, item?.id])

  function dismiss() {
    if (!item || dismissedRef.current) return
    dismissedRef.current = true
    onDismiss(item)
  }

  async function choose(style: AppIconStyle) {
    if (!item || dismissedRef.current || saving) return
    setSaving(true)
    try {
      await onSelectIcon?.(style)
      dismiss()
    } catch {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open && Boolean(item)}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <DialogContent
        className={cn(
          'flex max-h-[min(90vh,44rem)] flex-col overflow-hidden',
          'w-[min(92vw,480px)]',
        )}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{item?.title ?? ''}</DialogTitle>
          <DialogDescription>{item?.body ?? ''}</DialogDescription>
        </DialogHeader>
        {offersIconChoice ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Cuttler has a new app icon. You can keep your current one, or switch to the new mark.
            </p>
            <div className="flex items-end justify-center gap-3" role="group" aria-label="App icon">
              <Button
                type="button"
                variant="outline"
                disabled={saving || currentIcon == null}
                className="h-auto flex-col gap-1 rounded-xl border bg-white px-3 pt-2 pb-2 text-neutral-900 hover:bg-white dark:bg-white dark:text-neutral-900 dark:hover:bg-white"
                onClick={() => {
                  if (currentIcon) void choose(currentIcon)
                }}
              >
                {currentIcon ? (
                  <img
                    src={appIconPreviewSrc(currentIcon)}
                    alt=""
                    className="size-12 rounded-[0.6rem]"
                  />
                ) : (
                  <span className="size-12 rounded-[0.6rem] bg-neutral-100" />
                )}
                <span className="whitespace-nowrap text-[11px] leading-4">Keep current icon</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || currentIcon == null}
                className="h-auto flex-col gap-1 rounded-xl border bg-white px-3 pt-2 pb-2 text-neutral-900 hover:bg-white dark:bg-white dark:text-neutral-900 dark:hover:bg-white"
                onClick={() => void choose(CUTTLER_ICON)}
              >
                <img
                  src={appIconPreviewSrc(CUTTLER_ICON)}
                  alt=""
                  className="size-12 rounded-[0.6rem]"
                />
                <span className="whitespace-nowrap text-[11px] leading-4">Use new icon</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={dismiss}>
              Got it
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Announcement } from '../../shared/announcements.ts'

/**
 * Product announcement dialog — same visual language as Welcome onboarding
 * (shared Dialog tokens: popover surface, title, muted description, primary CTA).
 */
export function AnnouncementDialog({
  announcement,
  open,
  onDismiss,
}: {
  announcement: Announcement | null
  open: boolean
  onDismiss: (announcement: Announcement) => void
}) {
  const item = announcement
  const dismissedRef = useRef(false)

  useEffect(() => {
    if (open) dismissedRef.current = false
  }, [open, item?.id])

  function dismiss() {
    if (!item || dismissedRef.current) return
    dismissedRef.current = true
    onDismiss(item)
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
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={dismiss}>
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

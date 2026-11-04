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
import {
  ANNOUNCEMENTS,
  type Announcement,
  type AnnouncementPage,
} from '../../shared/announcements.ts'

const RENAME_PAGE_ID = 'rename'
const CUTTLER_ICON: AppIconStyle = 'cuttler'

type PageFigure = { src: string; alt: string }

const PAGE_FIGURES: Record<string, PageFigure[]> = {
  'smart-projects': [
    {
      src: '/announcement/smart-projects.png',
      alt: 'Manual and Smart project options',
    },
  ],
  'family-tags': [
    {
      src: '/announcement/family-tags.png',
      alt: 'New family tag dialog',
    },
  ],
  'document-font-sheet': [
    {
      src: '/announcement/document-font-sheet.png',
      alt: 'Document font groups: On, in the library but off, and Missing',
    },
  ],
  'library-search': [
    {
      src: '/announcement/library-search-typing.png',
      alt: 'Multi-word library search',
    },
    {
      src: '/announcement/library-search-tag.png',
      alt: 'Library search matching a family tag',
    },
  ],
  'search-filter-suggestions': [
    {
      src: '/announcement/search-filter-suggestions.png',
      alt: 'Search field with matching filter suggestions',
    },
  ],
  'new-tag-color': [
    {
      src: '/announcement/new-tag-color.png',
      alt: 'New tag dialog with color choices',
    },
  ],
}

function pagesFor(item: Announcement): AnnouncementPage[] {
  const defined = ANNOUNCEMENTS.find((entry) => entry.id === item.id)
  if (defined?.pages && defined.pages.length > 0) return defined.pages
  if (item.pages && item.pages.length > 0) return item.pages
  return [{ id: item.id, title: item.title, body: item.body }]
}

/**
 * Product announcement dialog — same visual language as Welcome onboarding
 * (shared Dialog tokens: popover surface, title, muted description, primary CTA).
 * One scrollable page per feature. Confetti stays on the main window.
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
  const pages = item ? pagesFor(item) : []
  const dismissedRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const resetKey = `${open}:${item?.id ?? ''}`
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setSaving(false)
    setPageIndex(0)
  }
  const page = pages[pageIndex] ?? null
  const offersIconChoice = page?.id === RENAME_PAGE_ID
  const figures = page ? PAGE_FIGURES[page.id] ?? [] : []
  const lastPage = pages.length === 0 || pageIndex >= pages.length - 1

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
      if (lastPage) dismiss()
      else {
        setSaving(false)
        setPageIndex((index) => index + 1)
      }
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
          <DialogTitle>{page?.title ?? item?.title ?? ''}</DialogTitle>
          <DialogDescription>{page?.body ?? item?.body ?? ''}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
          ) : figures.length > 0 ? (
            <div className="space-y-3">
              {figures.map((figure) => (
                <img
                  key={figure.src}
                  src={figure.src}
                  alt={figure.alt}
                  className="mx-auto block max-w-full rounded-md border"
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {pageIndex > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              >
                Back
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Step {pageIndex + 1} of {Math.max(pages.length, 1)}
            </p>
          </div>
          {offersIconChoice ? null : (
            <div className="flex justify-end gap-2">
              {lastPage ? (
                <Button type="button" onClick={dismiss}>
                  Got it
                </Button>
              ) : (
                <Button type="button" onClick={() => setPageIndex((index) => index + 1)}>
                  Next
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

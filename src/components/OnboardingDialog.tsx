import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { requestNotificationPermission } from '@/lib/notifications'
import type { AppSettings } from '@/lib/types'
import { cn } from '@/lib/utils'
import { mergeWatchFolders, watchFolderName } from '@/lib/watchFolders'

const STEPS = ['welcome', 'folders', 'installs', 'notify'] as const
type Step = (typeof STEPS)[number]

export function OnboardingDialog({
  open,
  settings,
  onSettingsChange,
  onComplete,
}: {
  open: boolean
  settings: AppSettings | null
  onSettingsChange: (settings: AppSettings) => void
  onComplete: () => void
}) {
  const folderInputRef = useRef<HTMLInputElement>(null)
  const finishedRef = useRef(false)
  const settingsRef = useRef(settings)
  const [step, setStep] = useState<Step>('welcome')
  const [busy, setBusy] = useState(false)
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [installAutomatically, setInstallAutomatically] = useState(true)
  const isDesktop = Boolean(window.fontButlerDesktop)
  const canPickFolder = Boolean(window.fontButlerDesktop?.pickFolder)
  const watchFolders = settings?.watchFolders ?? []
  const stepIndex = STEPS.indexOf(step) + 1

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!open) return
    finishedRef.current = false
    setStep('welcome')
    setBusy(false)
    const current = settingsRef.current
    setOpenAtLogin(current?.openAtLogin === true)
    setInstallAutomatically(
      current?.installAfterUpload !== false && current?.installWatchFolderFonts !== false,
    )
  }, [open])

  async function persist(patch: Parameters<typeof api.updateSettings>[0]) {
    const result = await api.updateSettings(patch)
    onSettingsChange(result.settings)
    return result.settings
  }

  async function finish() {
    if (finishedRef.current) return
    finishedRef.current = true
    setBusy(true)
    try {
      await persist({ onboardingCompleted: true })
      onComplete()
    } catch (error) {
      finishedRef.current = false
      toast.error(error instanceof Error ? error.message : 'Could not finish setup')
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setBusy(true)
    try {
      await persist({ openAtLogin })
      setStep('folders')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  async function addFolders(folders: string[]) {
    const next = mergeWatchFolders(watchFolders, folders)
    if (next.length === watchFolders.length) {
      toast.message(folders.length === 1 ? 'Already watching that folder' : 'Already watching those folders')
      return
    }
    setBusy(true)
    try {
      await persist({ watchFolders: next })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  async function chooseFolder() {
    const picked = await window.fontButlerDesktop?.pickFolder()
    if (!picked) return
    await addFolders([picked])
  }

  function addTypedFolder() {
    const next = folderInputRef.current?.value.trim()
    if (!next) return
    void addFolders([next]).then(() => {
      if (folderInputRef.current) folderInputRef.current.value = ''
    })
  }

  async function continueFromFolders() {
    const typed = folderInputRef.current?.value.trim()
    if (typed) {
      await addFolders([typed])
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
    setStep('installs')
  }

  async function continueFromInstalls() {
    setBusy(true)
    try {
      await persist({
        installAfterUpload: installAutomatically,
        installWatchFolderFonts: installAutomatically,
      })
      setStep('notify')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  async function allowNotifications() {
    setBusy(true)
    try {
      const permission = await requestNotificationPermission()
      await persist({ nativeNotifications: permission === 'granted' })
      if (permission !== 'granted') {
        toast.message('Notifications were not allowed. You can enable them later in Settings.')
      }
      await finish()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  const title =
    step === 'welcome'
      ? 'Welcome to Font Buttler'
      : step === 'folders'
        ? 'Watch folders'
        : step === 'installs'
          ? 'Install automatically?'
          : 'Allow notifications'

  const description =
    step === 'welcome'
      ? 'A source-tracked font manager for folders you already use. Drop fonts in, or watch a folder so new files are imported for you.'
      : step === 'folders'
        ? 'Fonts you add to these folders are imported automatically. Source files stay linked to their original path. You can skip this and add folders later.'
        : step === 'installs'
          ? 'Install fonts when you add them, and when a file appears in a watch folder. Turn this off to keep them in the library without installing.'
          : 'Font Buttler can notify you when fonts are installed or updated. You can change this later in Settings.'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void finish()
      }}
    >
      <DialogContent className="w-[min(92vw,480px)]">
        <DialogHeader className="pr-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === 'welcome' && isDesktop && (
          <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
            <input
              type="checkbox"
              checked={openAtLogin}
              disabled={busy}
              onChange={(event) => setOpenAtLogin(event.target.checked)}
              className="mt-0.5 size-3.5 rounded border border-input accent-primary"
            />
            <span>
              <span className="block text-sm">Open at login</span>
              <span className="block text-sm text-muted-foreground">
                Start Font Buttler when you turn on this computer.
              </span>
            </span>
          </Label>
        )}

        {step === 'folders' && (
          <div className="space-y-2">
            {watchFolders.length > 0 && (
              <ul className="space-y-1.5">
                {watchFolders.map((folder) => (
                  <li
                    key={folder}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{watchFolderName(folder)}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={folder}>
                        {folder}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 px-0"
                      disabled={busy}
                      aria-label={`Stop watching ${watchFolderName(folder)}`}
                      onClick={() =>
                        void persist({
                          watchFolders: watchFolders.filter((item) => item !== folder),
                        }).catch((error) => {
                          toast.error(error instanceof Error ? error.message : 'Could not save settings')
                        })
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Input
              ref={folderInputRef}
              placeholder="/Users/you/Fonts/Inbox"
              aria-label="Watch folder path"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTypedFolder()
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              {canPickFolder && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseFolder()}>
                  <FolderOpen className="size-4" />
                  Choose folder
                </Button>
              )}
              <Button type="button" variant="outline" disabled={busy} onClick={addTypedFolder}>
                Add folder
              </Button>
            </div>
          </div>
        )}

        {step === 'installs' && (
          <div className="space-y-2">
            {(
              [
                {
                  id: true,
                  label: 'Yes, install automatically',
                  detail: 'Install on drop or add, and when a font appears in a watch folder.',
                },
                {
                  id: false,
                  label: 'No, add to the library only',
                  detail: 'Keep new fonts in the list without installing them.',
                },
              ] as const
            ).map((option) => {
              const active = installAutomatically === option.id
              return (
                <button
                  key={String(option.id)}
                  type="button"
                  onClick={() => setInstallAutomatically(option.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active ? 'border-foreground bg-muted/60' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-muted-foreground">{option.detail}</div>
                  </div>
                  <span
                    className={cn(
                      'size-3.5 shrink-0 rounded-full border',
                      active ? 'border-foreground bg-foreground' : 'border-muted-foreground/40',
                    )}
                  />
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Step {stepIndex} of {STEPS.length}</p>
          <div className="flex justify-end gap-2">
            {step === 'welcome' ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void finish()}>
                  Skip setup
                </Button>
                <Button disabled={busy} onClick={() => void start()}>
                  Get started
                </Button>
              </>
            ) : step === 'notify' ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void finish()}>
                  Skip
                </Button>
                <Button disabled={busy} onClick={() => void allowNotifications()}>
                  Allow
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStep(step === 'folders' ? 'installs' : 'notify')}
                >
                  Skip
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void (step === 'folders' ? continueFromFolders() : continueFromInstalls())
                  }
                >
                  Continue
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

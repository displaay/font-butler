import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { FolderSetupDialog } from '@/components/FolderSetupDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { folderPolicyLabel } from '@/lib/folders'
import { persistNativeNotificationsEnabled, requestNotificationPermission } from '@/lib/notifications'
import type { AppSettings, WatchFolder } from '@/lib/types'
import { watchFolderName } from '@/lib/watchFolders'

const STEPS = ['welcome', 'folders', 'notify'] as const
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
  const finishedRef = useRef(false)
  const settingsRef = useRef(settings)
  const [step, setStep] = useState<Step>('welcome')
  const [busy, setBusy] = useState(false)
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const isDesktop = Boolean(window.fontButlerDesktop)
  const folders = settings?.folders ?? []
  const stepIndex = STEPS.indexOf(step) + 1

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!open) return
    finishedRef.current = false
    setStep('welcome')
    setBusy(false)
    setOpenAtLogin(settingsRef.current?.openAtLogin === true)
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

  async function allowNotifications() {
    setBusy(true)
    try {
      const permission = await requestNotificationPermission()
      await persist({ nativeNotifications: persistNativeNotificationsEnabled(true, permission) })
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
    step === 'welcome' ? 'Welcome to Font Buttler' : step === 'folders' ? 'Watch folders' : 'Allow notifications'
  const description =
    step === 'welcome'
      ? 'A source-tracked font manager for folders you already use. Drop fonts in, or watch a folder after you choose its policy.'
      : step === 'folders'
        ? 'Add a folder, choose whether new fonts are collected or installed, review the scan, then start watching. Nothing is installed until you confirm.'
        : 'Font Buttler can notify you when fonts are installed or updated. You can change this later in Settings.'

  return (
    <>
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
              {folders.length > 0 && (
                <ul className="space-y-1.5">
                  {folders.map((folder) => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      busy={busy}
                      onRemove={() =>
                        void persist({
                          watchFolders: folders.filter((item) => item.id !== folder.id).map((item) => item.root),
                        }).catch((error) => {
                          toast.error(error instanceof Error ? error.message : 'Could not save settings')
                        })
                      }
                    />
                  ))}
                </ul>
              )}
              <Button type="button" variant="outline" disabled={busy} onClick={() => setSetupOpen(true)}>
                Add folder
              </Button>
            </div>
          )}

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Step {stepIndex} of {STEPS.length}
            </p>
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
                  <Button variant="outline" disabled={busy} onClick={() => setStep('notify')}>
                    Skip
                  </Button>
                  <Button disabled={busy} onClick={() => setStep('notify')}>
                    Continue
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <FolderSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onDone={async () => {
          const latest = await api.settings()
          onSettingsChange(latest.settings)
        }}
      />
    </>
  )
}

function FolderRow({
  folder,
  busy,
  onRemove,
}: {
  folder: WatchFolder
  busy: boolean
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{watchFolderName(folder.root)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {folderPolicyLabel(folder.policy)}
          {folder.watching ? '' : ' · not watching yet'}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 px-0"
        disabled={busy}
        aria-label={`Stop watching ${watchFolderName(folder.root)}`}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </li>
  )
}

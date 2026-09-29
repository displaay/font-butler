import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { FolderSetupDialog } from '@/components/FolderSetupDialog'
import { RetailPane } from '@/components/RetailPane'
import { SettingsRow, SettingsSection } from '@/components/SettingsRow'
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
import { APP_ICON_OPTIONS, appIconPreviewSrc, parseAppIconStyle, type AppIconStyle } from '@/lib/appIcon'
import { collectDropPayload } from '@/lib/drop'
import { DESTINATIONS, folderPolicyLabel } from '@/lib/folders'
import { persistNativeNotificationsEnabled, requestNotificationPermission } from '@/lib/notifications'
import type { AppSettings, DefaultDestinationId, DestinationCapability, RetailSyncStatus, WatchFolder } from '@/lib/types'
import { cn } from '@/lib/utils'
import { watchFolderName } from '@/lib/watchFolders'

const ALL_STEPS = ['welcome', 'folders', 'fonts', 'destinations', 'notify', 'icon', 'done'] as const
type Step = (typeof ALL_STEPS)[number]

const CHECKBOX_CLASS = 'size-4 shrink-0 cursor-pointer rounded border border-input accent-primary'

function adobeFolderDetected(destinations: DestinationCapability[]): boolean {
  return destinations.some((item) => item.id === 'adobe-shared' && item.supported)
}

function visibleSteps(showDestinations: boolean): Step[] {
  return showDestinations ? [...ALL_STEPS] : ALL_STEPS.filter((step) => step !== 'destinations')
}

function previousStep(current: Step, showDestinations: boolean): Step | null {
  const steps = visibleSteps(showDestinations)
  const index = steps.indexOf(current)
  if (index > 0) return steps[index - 1] ?? null
  if (current === 'destinations') return 'fonts'
  return null
}

const COPY: Record<Step, { title: string; description: string }> = {
  welcome: {
    title: 'Welcome to Font Buttler',
    description:
      'A source-tracked font manager for folders you already use. Drop fonts in, or watch a folder after you choose its policy.',
  },
  folders: {
    title: 'Watch folders',
    description:
      'Add a folder to watch, or turn on Displaay retail. Retail choices are saved now; those fonts install after you finish setup.',
  },
  fonts: {
    title: 'Fonts',
    description: 'Choose whether dropped or updated fonts are installed automatically.',
  },
  destinations: {
    title: 'Destinations',
    description:
      'Choose where new installs go. Adobe is a folder for apps to pick up — not the same as installing for macOS.',
  },
  notify: {
    title: 'Allow notifications',
    description:
      'Font Buttler can notify you when fonts are installed or updated. You can change this later in Settings.',
  },
  icon: {
    title: 'Choose an app icon',
    description: 'Pick the Dock and menu bar icon. You can change this later in Settings.',
  },
  done: {
    title: "You're all set!",
    description: 'Watch folders, fonts, destinations, and Displaay retail live in Settings. You can change them any time.',
  },
}

export function OnboardingDialog({
  open,
  settings,
  onSettingsChange,
  onRetailChange,
  onComplete,
}: {
  open: boolean
  settings: AppSettings | null
  onSettingsChange: (settings: AppSettings) => void
  onRetailChange?: (status: RetailSyncStatus) => void
  onComplete: () => void
}) {
  const finishedRef = useRef(false)
  const finishingRef = useRef<Promise<void> | null>(null)
  const settleRetailRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const registerRetailSettle = useCallback((settle: () => Promise<void>) => {
    settleRetailRef.current = settle
  }, [])
  const settingsRef = useRef(settings)
  const onRetailChangeRef = useRef(onRetailChange)
  const installAfterId = useId()
  const autoReinstallId = useId()
  const [step, setStep] = useState<Step>('welcome')
  const [busy, setBusy] = useState(false)
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupRoots, setSetupRoots] = useState<string[] | undefined>()
  const [folderDragOver, setFolderDragOver] = useState(false)
  const [retailStatus, setRetailStatus] = useState<RetailSyncStatus | null>(null)
  const [adobeAvailable, setAdobeAvailable] = useState(false)
  const adobeAvailableRef = useRef(false)
  const adobeProbeRef = useRef<Promise<boolean> | null>(null)
  const [destinationId, setDestinationId] = useState<DefaultDestinationId>('macos')
  const [installAfterUpload, setInstallAfterUpload] = useState(true)
  const [autoReinstallOnUpdate, setAutoReinstallOnUpdate] = useState(false)
  const [appIcon, setAppIcon] = useState<AppIconStyle>('classic')
  const isDesktop = Boolean(window.fontButlerDesktop)
  const folders = settings?.folders ?? []
  const steps = visibleSteps(adobeAvailable)
  const stepIndex = Math.max(1, steps.indexOf(step) + 1)
  const backStep = previousStep(step, adobeAvailable)
  const { title, description } = COPY[step]
  const locked = busy

  async function probeAdobe(): Promise<boolean> {
    if (!adobeProbeRef.current) {
      adobeProbeRef.current = api
        .destinations()
        .then((result) => adobeFolderDetected(result.destinations))
        .catch(() => false)
        .then((detected) => {
          adobeAvailableRef.current = detected
          setAdobeAvailable(detected)
          return detected
        })
    }
    return adobeProbeRef.current
  }

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    onRetailChangeRef.current = onRetailChange
  }, [onRetailChange])

  useEffect(() => {
    if (!open) return
    finishedRef.current = false
    setStep('welcome')
    setBusy(false)
    setOpenAtLogin(settingsRef.current?.openAtLogin === true)
    setRetailStatus(null)
    setDestinationId(settingsRef.current?.defaultDestination ?? 'macos')
    setInstallAfterUpload(settingsRef.current?.installAfterUpload !== false)
    setAutoReinstallOnUpdate(settingsRef.current?.autoReinstallOnUpdate === true)
    setAppIcon(parseAppIconStyle(settingsRef.current?.appIcon))
    setFolderDragOver(false)
    setSetupRoots(undefined)
    adobeProbeRef.current = null
    adobeAvailableRef.current = false
    setAdobeAvailable(false)
    void probeAdobe()
    void api.retail
      .status()
      .then((result) => {
        setRetailStatus(result.status)
        onRetailChangeRef.current?.(result.status)
      })
      .catch(() => {
        setRetailStatus(null)
      })
  }, [open])

  async function persist(patch: Parameters<typeof api.updateSettings>[0]) {
    const result = await api.updateSettings(patch)
    onSettingsChange(result.settings)
    return result.settings
  }

  async function finish() {
    if (finishedRef.current) return
    if (finishingRef.current) return finishingRef.current
    const job = (async () => {
      setBusy(true)
      try {
        await settleRetailRef.current()
        if (finishedRef.current) return
        finishedRef.current = true
        onComplete()
        await persist({ onboardingCompleted: true })
      } catch (error) {
        finishedRef.current = false
        toast.error(error instanceof Error ? error.message : 'Could not finish setup')
      } finally {
        setBusy(false)
        finishingRef.current = null
      }
    })()
    finishingRef.current = job
    return job
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

  async function leaveFolders() {
    setBusy(true)
    try {
      await settleRetailRef.current()
      setStep('fonts')
    } finally {
      setBusy(false)
    }
  }

  async function afterFonts() {
    setStep((await probeAdobe()) ? 'destinations' : 'notify')
  }

  async function leaveFonts(save: boolean) {
    if (!save) {
      void afterFonts()
      return
    }
    setBusy(true)
    try {
      await persist({ installAfterUpload, autoReinstallOnUpdate })
      await afterFonts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save font settings')
    } finally {
      setBusy(false)
    }
  }

  async function leaveDestinations(save: boolean) {
    if (save) {
      setBusy(true)
      try {
        await persist({ defaultDestination: destinationId })
        setStep('notify')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not save destinations')
      } finally {
        setBusy(false)
      }
      return
    }
    setStep('notify')
  }

  async function allowNotifications() {
    setBusy(true)
    try {
      const permission = await requestNotificationPermission()
      await persist({ nativeNotifications: persistNativeNotificationsEnabled(true, permission) })
      if (permission !== 'granted') {
        toast.message('Notifications were not allowed. You can enable them later in Settings.')
      }
      setStep('icon')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  async function leaveIcon(save: boolean) {
    if (!save) {
      setStep('done')
      return
    }
    setBusy(true)
    try {
      await persist({ appIcon })
      setStep('done')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save app icon')
    } finally {
      setBusy(false)
    }
  }

  function openAddFolder(roots?: string[]) {
    setSetupRoots(roots && roots.length > 0 ? roots : undefined)
    setSetupOpen(true)
  }

  async function handleFolderDrop(dataTransfer: DataTransfer) {
    try {
      const payload = await collectDropPayload(dataTransfer)
      if (payload.folders.length === 0) {
        toast.message('Drop a folder to watch it.')
        return
      }
      openAddFolder(payload.folders)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read that drop')
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) void finish()
        }}
      >
        <DialogContent
          className={cn(
            'flex max-h-[min(90vh,44rem)] flex-col overflow-hidden',
            step === 'folders' ? 'w-[min(94vw,760px)]' : 'w-[min(92vw,480px)]',
          )}
        >
          <DialogHeader className="pr-6">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {step === 'welcome' && isDesktop && (
              <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
                <input
                  type="checkbox"
                  checked={openAtLogin}
                  disabled={locked}
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
              <div className="space-y-4">
                <div className="space-y-2">
                  {folders.length > 0 && (
                    <ul className="space-y-1.5">
                      {folders.map((folder) => (
                        <FolderRow
                          key={folder.id}
                          folder={folder}
                          busy={locked}
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
                  <div
                    onDragEnter={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (!locked) setFolderDragOver(true)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      event.dataTransfer.dropEffect = 'copy'
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                      setFolderDragOver(false)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setFolderDragOver(false)
                      if (locked) return
                      void handleFolderDrop(event.dataTransfer)
                    }}
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center',
                      folderDragOver ? 'border-foreground bg-muted/50' : 'border-border bg-muted/20',
                    )}
                  >
                    <p className="text-sm text-muted-foreground">Drop folders here</p>
                    <Button type="button" variant="outline" disabled={locked} onClick={() => openAddFolder()}>
                      Add folder
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <RetailPane
                    status={retailStatus}
                    busy={locked}
                    deferInstall
                    onSettle={registerRetailSettle}
                    onStatus={(status) => {
                      setRetailStatus(status)
                      onRetailChangeRef.current?.(status)
                    }}
                  />
                </div>
              </div>
            )}

            {step === 'fonts' && (
              <SettingsSection>
                <SettingsRow
                  label="Activate after adding"
                  description="Turn this off to add fonts to the library without activating."
                  htmlFor={installAfterId}
                >
                  <input
                    id={installAfterId}
                    type="checkbox"
                    checked={installAfterUpload}
                    disabled={locked}
                    onChange={(event) => setInstallAfterUpload(event.target.checked)}
                    className={CHECKBOX_CLASS}
                  />
                </SettingsRow>
                <SettingsRow
                  label="Automatically reinstall when an update is detected"
                  description="When a tracked source file changes, reinstall the installed copy. Off by default."
                  htmlFor={autoReinstallId}
                >
                  <input
                    id={autoReinstallId}
                    type="checkbox"
                    checked={autoReinstallOnUpdate}
                    disabled={locked}
                    onChange={(event) => setAutoReinstallOnUpdate(event.target.checked)}
                    className={CHECKBOX_CLASS}
                  />
                </SettingsRow>
              </SettingsSection>
            )}

            {step === 'destinations' && (
              <div className="space-y-2">
                {DESTINATIONS.map((option) => {
                  const active = destinationId === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={locked}
                      onClick={() => setDestinationId(option.id)}
                      className={cn(
                        'flex w-full items-start rounded-lg border px-3 py-2.5 text-left',
                        active ? 'border-foreground bg-muted/60' : 'border-border hover:bg-muted/40',
                      )}
                    >
                      <div>
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.detail}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {step === 'icon' && (
              <div role="radiogroup" aria-label="App icon" className="flex items-end gap-2">
                {APP_ICON_OPTIONS.map((option) => {
                  const selected = appIcon === option.id
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      variant="ghost"
                      role="radio"
                      aria-checked={selected}
                      aria-label={option.label}
                      title={option.label}
                      disabled={locked}
                      className={cn(
                        'h-auto flex-col gap-1 rounded-xl border px-1.5 pb-1 pt-0.5',
                        selected
                          ? 'border-foreground/30 bg-muted ring-2 ring-ring/40'
                          : 'border-border text-muted-foreground',
                      )}
                      onClick={() => setAppIcon(option.id)}
                    >
                      <img
                        src={appIconPreviewSrc(option.id)}
                        alt=""
                        className="size-12 rounded-[0.6rem]"
                      />
                      <span className="whitespace-nowrap text-[11px] leading-4">{option.label}</span>
                    </Button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              {backStep ? (
                <Button variant="ghost" disabled={locked} onClick={() => setStep(backStep)}>
                  Back
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Step {stepIndex} of {steps.length}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              {step === 'welcome' ? (
                <>
                  <Button variant="outline" disabled={locked} onClick={() => void finish()}>
                    Skip setup
                  </Button>
                  <Button disabled={locked} onClick={() => void start()}>
                    Get started
                  </Button>
                </>
              ) : step === 'folders' ? (
                <>
                  <Button variant="outline" disabled={locked} onClick={() => void leaveFolders()}>
                    Skip
                  </Button>
                  <Button disabled={locked} onClick={() => void leaveFolders()}>
                    Continue
                  </Button>
                </>
              ) : step === 'fonts' ? (
                <>
                  <Button variant="outline" disabled={locked} onClick={() => void leaveFonts(false)}>
                    Skip
                  </Button>
                  <Button disabled={locked} onClick={() => void leaveFonts(true)}>
                    Continue
                  </Button>
                </>
              ) : step === 'destinations' ? (
                <>
                  <Button variant="outline" disabled={locked} onClick={() => void leaveDestinations(false)}>
                    Skip
                  </Button>
                  <Button disabled={locked} onClick={() => void leaveDestinations(true)}>
                    Continue
                  </Button>
                </>
              ) : step === 'notify' ? (
                <>
                  <Button variant="outline" disabled={locked} onClick={() => setStep('icon')}>
                    Skip
                  </Button>
                  <Button disabled={locked} onClick={() => void allowNotifications()}>
                    Allow
                  </Button>
                </>
              ) : step === 'icon' ? (
                <>
                  <Button variant="outline" disabled={locked} onClick={() => void leaveIcon(false)}>
                    Skip
                  </Button>
                  <Button disabled={locked} onClick={() => void leaveIcon(true)}>
                    Continue
                  </Button>
                </>
              ) : (
                <Button disabled={locked} onClick={() => void finish()}>
                  Done
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <FolderSetupDialog
        open={setupOpen}
        roots={setupRoots}
        deferInstall
        onOpenChange={(next) => {
          setSetupOpen(next)
          if (!next) setSetupRoots(undefined)
        }}
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

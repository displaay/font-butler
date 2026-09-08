import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlignVerticalSpaceAround, Loader2 } from 'lucide-react'
import { catalogFontFamily } from '@/components/FontFaceStyles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { usePreviewFontReady } from '@/hooks/usePreviewFontReady'
import { api } from '@/lib/api'
import { formatMissingCharacters, missingCodePoints } from '@/lib/coverage'
import { groupOtFeatures } from '@/lib/otFeatures'
import { DEFAULT_SPECIMEN, SPECIMEN_PRESETS } from '@/lib/specimen'
import type { CatalogEntry, FontAxisInfo, PreviewPreferences } from '@/lib/types'
import { cn } from '@/lib/utils'

type PreviewMeta = {
  axes?: FontAxisInfo[]
  namedInstances?: Array<{ name: string; coordinates: Record<string, number> }>
  features?: string[]
  characterSet?: number[]
  format?: string
}

const DEFAULT_ON_FEATURES = new Set(['calt', 'kern', 'liga'])

export function SpecimenWorkspace({
  entry,
  specimen,
  onSpecimenChange,
  compare,
  compareEntry,
  size = 'default',
}: {
  entry: CatalogEntry
  specimen: PreviewPreferences
  onSpecimenChange: (next: PreviewPreferences) => void
  compare?: 'source' | 'families'
  compareEntry?: CatalogEntry | null
  size?: 'default' | 'large'
}) {
  const [meta, setMeta] = useState<PreviewMeta | null>(null)
  const [axes, setAxes] = useState<Record<string, number>>({})
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [instanceName, setInstanceName] = useState<string>('Default')
  const [liveSize, setLiveSize] = useState(specimen.size)
  const [liveLineHeight, setLiveLineHeight] = useState(specimen.lineHeight)
  const specimenRef = useRef(specimen)
  const liveSizeRef = useRef(specimen.size)
  const liveLineHeightRef = useRef(specimen.lineHeight)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSpecimenChangeRef = useRef(onSpecimenChange)

  specimenRef.current = specimen
  onSpecimenChangeRef.current = onSpecimenChange

  useEffect(() => {
    if (persistTimer.current) return
    liveSizeRef.current = specimen.size
    liveLineHeightRef.current = specimen.lineHeight
    setLiveSize(specimen.size)
    setLiveLineHeight(specimen.lineHeight)
  }, [specimen.size, specimen.lineHeight])

  useEffect(() => {
    return () => {
      if (!persistTimer.current) return
      clearTimeout(persistTimer.current)
      persistTimer.current = null
      onSpecimenChangeRef.current({
        ...specimenRef.current,
        size: liveSizeRef.current,
        lineHeight: liveLineHeightRef.current,
      })
    }
  }, [])

  function persistLiveSliders() {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    onSpecimenChangeRef.current({
      ...specimenRef.current,
      size: liveSizeRef.current,
      lineHeight: liveLineHeightRef.current,
    })
  }

  function scheduleSliderPersist() {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null
      persistLiveSliders()
    }, 280)
  }

  function setLiveSlider(patch: { size?: number; lineHeight?: number }) {
    if (patch.size != null) {
      liveSizeRef.current = patch.size
      setLiveSize(patch.size)
    }
    if (patch.lineHeight != null) {
      liveLineHeightRef.current = patch.lineHeight
      setLiveLineHeight(patch.lineHeight)
    }
    scheduleSliderPersist()
  }

  const liveInstalledFamily = catalogFontFamily(entry.id, 'installed')
  const liveSourceFamily = catalogFontFamily(entry.id, 'source')
  const otherFamily = compareEntry ? catalogFontFamily(compareEntry.id, 'installed') : ''
  const compareFamilies = compare === 'families' && Boolean(compareEntry)

  useEffect(() => {
    let cancelled = false
    void api
      .previewMeta(entry.id, entry.installedPath ? 'installed' : 'source')
      .then((result) => {
        if (cancelled) return
        setMeta(result)
        const next: Record<string, number> = {}
        for (const axis of result.axes ?? []) next[axis.tag] = axis.default
        setAxes(next)
        setFeatures(
          Object.fromEntries(
            groupOtFeatures(result.features ?? [])
              .flatMap((group) => group.tags)
              .map((tag) => [tag, DEFAULT_ON_FEATURES.has(tag)]),
          ),
        )
        setInstanceName('Default')
      })
      .catch(() => {
        if (!cancelled) setMeta(null)
      })
    return () => {
      cancelled = true
    }
  }, [
    entry.id,
    entry.installedPath,
    entry.disabledPath,
    entry.sourceFingerprint,
    entry.sourceMtimeMs,
    entry.sourceSize,
    entry.installedFingerprint,
  ])

  const missing = useMemo(
    () => missingCodePoints(specimen.text, meta?.characterSet),
    [specimen.text, meta?.characterSet],
  )
  const featureGroups = useMemo(() => groupOtFeatures(meta?.features ?? []), [meta?.features])

  const variation = Object.entries(axes)
    .map(([tag, value]) => `'${tag}' ${value}`)
    .join(', ')
  const featureSettings = Object.entries(features)
    .map(([tag, on]) => `'${tag}' ${on ? 1 : 0}`)
    .join(', ')

  function applyPreset(preset: PreviewPreferences['preset']) {
    if (preset === 'custom') {
      onSpecimenChange({ ...specimen, preset })
      return
    }
    onSpecimenChange({
      ...specimen,
      preset,
      text: SPECIMEN_PRESETS[preset].text,
    })
  }

  function setSpecimenText(text: string) {
    onSpecimenChange({ ...specimen, text, preset: 'custom' })
  }

  function setAxis(tag: string, value: number) {
    setAxes((current) => ({ ...current, [tag]: value }))
    setInstanceName('Custom')
  }

  function applyInstance(name: string, coordinates: Record<string, number>) {
    setAxes(coordinates)
    setInstanceName(name)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SPECIMEN_PRESETS) as Array<PreviewPreferences['preset']>).map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={specimen.preset === preset ? 'default' : 'outline'}
            onClick={() => applyPreset(preset)}
          >
            {SPECIMEN_PRESETS[preset].label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onSpecimenChange({ ...DEFAULT_SPECIMEN })}
        >
          Reset
        </Button>
      </div>
      {compareFamilies ? (
        <div className="grid gap-2 md:grid-cols-2">
          <SpecimenPane
            label={entry.faces[0]?.familyName || 'A'}
            family={entry.installedPath ? liveInstalledFamily : liveSourceFamily}
            text={specimen.text}
            size={liveSize}
            lineHeight={liveLineHeight}
            variation={variation}
            features={featureSettings}
            format={entry.format}
            large={size === 'large'}
            sliders={{ size: liveSize, lineHeight: liveLineHeight }}
            onSliderChange={setLiveSlider}
            onSliderCommit={persistLiveSliders}
            onTextChange={setSpecimenText}
          />
          <SpecimenPane
            label={compareEntry?.faces[0]?.familyName || 'B'}
            family={otherFamily}
            text={specimen.text}
            size={liveSize}
            lineHeight={liveLineHeight}
            variation={variation}
            features={featureSettings}
            format={compareEntry?.format}
            large={size === 'large'}
            onTextChange={setSpecimenText}
          />
        </div>
      ) : (
        <SpecimenPane
          label={entry.previewOnly ? 'Preview only' : entry.installedPath ? 'Installed' : 'Source'}
          family={entry.installedPath ? liveInstalledFamily : liveSourceFamily}
          text={specimen.text}
          size={liveSize}
          lineHeight={liveLineHeight}
          variation={variation}
          features={featureSettings}
          format={entry.format}
          large={size === 'large'}
          sliders={{ size: liveSize, lineHeight: liveLineHeight }}
          onSliderChange={setLiveSlider}
          onSliderCommit={persistLiveSliders}
          onTextChange={setSpecimenText}
        />
      )}
      {(meta?.axes?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={instanceName === 'Default' ? 'default' : 'outline'}
              onClick={() => {
                const next: Record<string, number> = {}
                for (const axis of meta?.axes ?? []) next[axis.tag] = axis.default
                applyInstance('Default', next)
              }}
            >
              Default
            </Button>
            {(meta?.namedInstances ?? []).map((instance) => (
              <Button
                key={instance.name}
                type="button"
                size="sm"
                variant={instanceName === instance.name ? 'default' : 'outline'}
                onClick={() => applyInstance(instance.name, instance.coordinates)}
              >
                {instance.name}
              </Button>
            ))}
          </div>
          {(meta?.axes ?? []).map((axis) => (
            <Label key={axis.tag} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 font-normal">
              <span className="truncate">{axis.name || axis.tag}</span>
              <span className="flex h-7 items-center">
                <Slider
                  min={axis.min}
                  max={axis.max}
                  step={(axis.max - axis.min) / 100}
                  value={axes[axis.tag] ?? axis.default}
                  aria-label={`${axis.name || axis.tag} axis`}
                  onChange={(event) => setAxis(axis.tag, Number(event.target.value))}
                />
              </span>
              <Input
                type="number"
                className="h-7 px-1.5 text-xs tabular-nums"
                value={axes[axis.tag] ?? axis.default}
                onChange={(event) => setAxis(axis.tag, Number(event.target.value))}
              />
            </Label>
          ))}
        </div>
      )}
      {featureGroups.length > 0 && (
        <div className="space-y-3">
          {featureGroups.map((group) => (
            <div key={group.id} className="space-y-1.5">
              <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.tags.map((tag) => (
                  <Button
                    key={tag}
                    type="button"
                    size="sm"
                    variant={features[tag] ? 'default' : 'outline'}
                    onClick={() => setFeatures((current) => ({ ...current, [tag]: !current[tag] }))}
                  >
                    {tag}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {missing.length} missing {missing.length === 1 ? 'character' : 'characters'}:{' '}
          {formatMissingCharacters(missing)}
        </p>
      )}
    </div>
  )
}

function CompactSpecimenSlider({
  ariaLabel,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  start,
  end,
}: {
  ariaLabel: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  onCommit?: () => void
  start: ReactNode
  end?: ReactNode
}) {
  return (
    <label className="flex h-6 min-w-0 flex-1 items-center gap-1.5" title={ariaLabel}>
      <span className="shrink-0 select-none text-muted-foreground" aria-hidden>
        {start}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        className="preview-size-slider min-w-0 w-full"
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      {end ? (
        <span className="shrink-0 select-none text-muted-foreground" aria-hidden>
          {end}
        </span>
      ) : null}
    </label>
  )
}

function SpecimenPane({
  label,
  family,
  text,
  size,
  lineHeight,
  variation,
  features,
  format,
  large,
  sliders,
  onSliderChange,
  onSliderCommit,
  onTextChange,
}: {
  label: string
  family: string
  text: string
  size: number
  lineHeight: number
  variation: string
  features: string
  format?: string
  large?: boolean
  sliders?: { size: number; lineHeight: number }
  onSliderChange?: (patch: { size?: number; lineHeight?: number }) => void
  onSliderCommit?: () => void
  onTextChange: (text: string) => void
}) {
  const ready = usePreviewFontReady(family)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const node = textRef.current
    if (!node || !ready) return
    const frame = requestAnimationFrame(() => {
      node.style.height = 'auto'
      node.style.height = `${Math.max(node.scrollHeight, large ? 256 : 72)}px`
    })
    return () => cancelAnimationFrame(frame)
  }, [text, size, lineHeight, variation, features, large, ready])

  return (
    <div className={cn('rounded-lg border bg-muted/30 p-3', large && 'min-h-[20rem] p-5')}>
      <div className="mb-2 flex items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
          {format ? ` · ${format}` : ''}
        </div>
        {sliders && onSliderChange ? (
          <div className="flex w-1/2 min-w-0 items-center gap-3">
            <CompactSpecimenSlider
              ariaLabel="Specimen size"
              min={8}
              max={160}
              step={1}
              value={sliders.size}
              onChange={(value) => onSliderChange({ size: value })}
              onCommit={onSliderCommit}
              start={<span className="text-[9px] leading-none">A</span>}
              end={<span className="text-xs leading-none">A</span>}
            />
            <CompactSpecimenSlider
              ariaLabel="Specimen line height"
              min={0.8}
              max={3}
              step={0.05}
              value={sliders.lineHeight}
              onChange={(value) => onSliderChange({ lineHeight: value })}
              onCommit={onSliderCommit}
              start={<AlignVerticalSpaceAround className="size-3" />}
            />
          </div>
        ) : null}
      </div>
      <div className={cn('relative', large && 'min-h-[16rem]')}>
        {!ready ? (
          <div
            className={cn(
              'flex items-center justify-center',
              large ? 'min-h-[16rem]' : 'min-h-[4.5rem]',
            )}
            role="status"
            aria-label="Loading preview"
          >
            <Loader2 className="size-5 animate-spin text-muted-foreground/70 motion-reduce:animate-none" />
          </div>
        ) : (
          <textarea
            ref={textRef}
            value={text}
            aria-label="Specimen text"
            spellCheck={false}
            className={cn(
              'font-preview w-full resize-none overflow-hidden bg-transparent p-0 break-words whitespace-pre-wrap outline-none',
              large ? 'min-h-[16rem]' : 'min-h-[4.5rem]',
            )}
            style={{
              fontFamily: `"${family}"`,
              fontSize: size,
              lineHeight,
              fontVariationSettings: variation || undefined,
              fontFeatureSettings: features || undefined,
            }}
            onChange={(event) => onTextChange(event.target.value)}
          />
        )}
      </div>
    </div>
  )
}

export { specimenFromSettings } from '@/lib/specimen'

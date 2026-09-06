import { useEffect, useMemo, useRef, useState } from 'react'
import { catalogFontFamily } from '@/components/FontFaceStyles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import {
  canCompareInstalledVsSource,
  capturedFontFamily,
  isComparisonSourceStale,
} from '@/lib/comparison'
import { formatMissingCharacters, missingCodePoints } from '@/lib/coverage'
import { catalogFontFaceRules, catalogFontUrl } from '@/lib/preview'
import { DEFAULT_SPECIMEN, SPECIMEN_PRESETS, specimenFromSettings } from '@/lib/specimen'
import type { CatalogEntry, ComparisonCapture, FontAxisInfo, PreviewPreferences } from '@/lib/types'
import { cn } from '@/lib/utils'

type PreviewMeta = {
  axes?: FontAxisInfo[]
  namedInstances?: Array<{ name: string; coordinates: Record<string, number> }>
  features?: string[]
  characterSet?: number[]
  format?: string
}

const FEATURE_LABELS: Record<string, string> = {
  kern: 'Kerning',
  liga: 'Ligatures',
  dlig: 'Discretionary ligatures',
  calt: 'Contextual alternates',
  smcp: 'Small caps',
  onum: 'Oldstyle figures',
  tnum: 'Tabular figures',
  ss01: 'Stylistic set 1',
  ss02: 'Stylistic set 2',
}

export function SpecimenWorkspace({
  entry,
  specimen,
  onSpecimenChange,
  compare,
  compareEntry,
  onCaptureChange,
}: {
  entry: CatalogEntry
  specimen: PreviewPreferences
  onSpecimenChange: (next: PreviewPreferences) => void
  compare?: 'source' | 'families'
  compareEntry?: CatalogEntry | null
  onCaptureChange?: (capture: ComparisonCapture | null) => void
}) {
  const [meta, setMeta] = useState<PreviewMeta | null>(null)
  const [sourceMeta, setSourceMeta] = useState<PreviewMeta | null>(null)
  const [axes, setAxes] = useState<Record<string, number>>({})
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [instanceName, setInstanceName] = useState<string>('Default')
  const [capture, setCapture] = useState<ComparisonCapture | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const onCaptureChangeRef = useRef(onCaptureChange)
  onCaptureChangeRef.current = onCaptureChange

  const canCompareSource = compare !== 'families' && canCompareInstalledVsSource(entry)
  const freezeComparison = canCompareSource
  const newerSource = isComparisonSourceStale(capture, entry.sourceFingerprint)

  const liveInstalledFamily = catalogFontFamily(entry.id, 'installed')
  const liveSourceFamily = catalogFontFamily(entry.id, 'source')
  const otherFamily = compareEntry ? catalogFontFamily(compareEntry.id, 'installed') : ''
  const installedFamily =
    freezeComparison && capture?.installedFingerprint
      ? capturedFontFamily(entry.id, 'installed')
      : liveInstalledFamily
  const sourceFamily =
    freezeComparison && capture?.sourceFingerprint
      ? capturedFontFamily(entry.id, 'source')
      : liveSourceFamily

  useEffect(() => {
    if (!freezeComparison) {
      setCapture(null)
      onCaptureChangeRef.current?.(null)
      return
    }
    let cancelled = false
    void api
      .captureComparison(entry.id)
      .then((result) => {
        if (cancelled) return
        setCapture(result)
        onCaptureChangeRef.current?.(result)
      })
      .catch(() => {
        if (cancelled) return
        setCapture(null)
        onCaptureChangeRef.current?.(null)
      })
    return () => {
      cancelled = true
    }
  }, [freezeComparison, entry.id])

  useEffect(() => {
    if (!freezeComparison || !capture?.installedFingerprint || !capture.sourceFingerprint) return
    const rules = [
      ...catalogFontFaceRules(
        capturedFontFamily(entry.id, 'installed'),
        catalogFontUrl(entry, 'revision', capture.installedFingerprint),
        entry.faces,
      ),
      ...catalogFontFaceRules(
        capturedFontFamily(entry.id, 'source'),
        catalogFontUrl(entry, 'revision', capture.sourceFingerprint),
        entry.faces,
      ),
    ].join('\n')
    const style = document.createElement('style')
    style.setAttribute('data-font-butler-comparison', entry.id)
    style.textContent = rules
    document.head.append(style)
    return () => style.remove()
    // Pin captured @font-face URLs; do not recreate when catalog sourceFingerprint changes.
  }, [freezeComparison, capture?.installedFingerprint, capture?.sourceFingerprint, entry.id])

  useEffect(() => {
    if (freezeComparison) return
    let cancelled = false
    void api
      .previewMeta(entry.id, entry.installedPath ? 'installed' : 'source')
      .then((result) => {
        if (cancelled) return
        setMeta(result)
        const next: Record<string, number> = {}
        for (const axis of result.axes ?? []) next[axis.tag] = axis.default
        setAxes(next)
        setFeatures({})
        setInstanceName('Default')
      })
      .catch(() => {
        if (!cancelled) setMeta(null)
      })
    if (entry.sourcePath && entry.sourceAvailability === 'present') {
      void api
        .previewMeta(entry.id, 'source')
        .then((result) => {
          if (!cancelled) setSourceMeta(result)
        })
        .catch(() => {
          if (!cancelled) setSourceMeta(null)
        })
    } else {
      setSourceMeta(null)
    }
    return () => {
      cancelled = true
    }
  }, [
    freezeComparison,
    entry.id,
    entry.installedPath,
    entry.sourcePath,
    entry.sourceAvailability,
    entry.sourceFingerprint,
  ])

  useEffect(() => {
    if (!freezeComparison || !capture || capture.id !== entry.id) return
    let cancelled = false
    const installedRevision = capture.installedFingerprint
    const sourceRevision = capture.sourceFingerprint
    void api
      .previewMeta(entry.id, installedRevision ? 'revision' : 'installed', installedRevision ?? undefined)
      .then((result) => {
        if (cancelled) return
        setMeta(result)
        const next: Record<string, number> = {}
        for (const axis of result.axes ?? []) next[axis.tag] = axis.default
        setAxes(next)
        setFeatures({})
        setInstanceName('Default')
      })
      .catch(() => {
        if (!cancelled) setMeta(null)
      })
    void api
      .previewMeta(entry.id, 'revision', sourceRevision)
      .then((result) => {
        if (!cancelled) setSourceMeta(result)
      })
      .catch(() => {
        if (!cancelled) setSourceMeta(null)
      })
    return () => {
      cancelled = true
    }
  }, [freezeComparison, capture, entry.id])

  const missing = useMemo(
    () => missingCodePoints(specimen.text, meta?.characterSet),
    [specimen.text, meta?.characterSet],
  )

  const variation = Object.entries(axes)
    .map(([tag, value]) => `'${tag}' ${value}`)
    .join(', ')
  const featureSettings = Object.entries(features)
    .filter(([, on]) => on)
    .map(([tag]) => `'${tag}' 1`)
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

  function setAxis(tag: string, value: number) {
    setAxes((current) => ({ ...current, [tag]: value }))
    setInstanceName('Custom')
  }

  function applyInstance(name: string, coordinates: Record<string, number>) {
    setAxes(coordinates)
    setInstanceName(name)
  }

  function refreshComparison() {
    setRefreshing(true)
    void api
      .captureComparison(entry.id)
      .then((result) => {
        setCapture(result)
        onCaptureChangeRef.current?.(result)
      })
      .finally(() => setRefreshing(false))
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
      <textarea
        value={specimen.text}
        aria-label="Specimen text"
        className="min-h-16 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onChange={(event) =>
          onSpecimenChange({ ...specimen, text: event.target.value, preset: 'custom' })
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <Label className="space-y-1 font-normal">
          <span className="text-xs text-muted-foreground">Size</span>
          <Input
            type="number"
            min={8}
            max={160}
            value={specimen.size}
            aria-label="Specimen size"
            onChange={(event) =>
              onSpecimenChange({ ...specimen, size: Number(event.target.value) || specimen.size })
            }
          />
        </Label>
        <Label className="space-y-1 font-normal">
          <span className="text-xs text-muted-foreground">Line height</span>
          <Input
            type="number"
            min={0.8}
            max={3}
            step={0.05}
            value={specimen.lineHeight}
            aria-label="Specimen line height"
            onChange={(event) =>
              onSpecimenChange({
                ...specimen,
                lineHeight: Number(event.target.value) || specimen.lineHeight,
              })
            }
          />
        </Label>
      </div>
      {canCompareSource || compare === 'families' ? (
        <div className="grid gap-2 md:grid-cols-2">
          <SpecimenPane
            label={compare === 'families' ? entry.faces[0]?.familyName || 'A' : 'Installed'}
            family={installedFamily}
            text={specimen.text}
            size={specimen.size}
            lineHeight={specimen.lineHeight}
            variation={variation}
            features={featureSettings}
            format={entry.format}
            version={entry.faces[0]?.fullName}
          />
          <SpecimenPane
            label={
              compare === 'families'
                ? compareEntry?.faces[0]?.familyName || 'B'
                : newerSource
                  ? 'Source · newer available'
                  : 'Source'
            }
            family={compare === 'families' ? otherFamily : sourceFamily}
            text={specimen.text}
            size={specimen.size}
            lineHeight={specimen.lineHeight}
            variation={variation}
            features={featureSettings}
            format={compare === 'families' ? compareEntry?.format : entry.format}
            version={compareEntry?.faces[0]?.fullName}
          />
        </div>
      ) : (
        <SpecimenPane
          label={entry.previewOnly ? 'Preview only' : entry.installedPath ? 'Installed' : 'Source'}
          family={entry.installedPath ? liveInstalledFamily : liveSourceFamily}
          text={specimen.text}
          size={specimen.size}
          lineHeight={specimen.lineHeight}
          variation={variation}
          features={featureSettings}
          format={entry.format}
        />
      )}
      {newerSource && canCompareSource && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            A newer source is available. Refresh comparison after reviewing it; Install update uses
            the revision you are looking at.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={refreshComparison}
          >
            Refresh comparison
          </Button>
        </div>
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
            <Label key={axis.tag} className="grid grid-cols-[4rem_1fr_4rem] items-center gap-2 font-normal">
              <span className="truncate text-xs">{axis.name || axis.tag}</span>
              <input
                type="range"
                min={axis.min}
                max={axis.max}
                step={(axis.max - axis.min) / 100}
                value={axes[axis.tag] ?? axis.default}
                aria-label={`${axis.name || axis.tag} axis`}
                onChange={(event) => setAxis(axis.tag, Number(event.target.value))}
              />
              <Input
                type="number"
                className="h-7 px-1 text-xs"
                value={axes[axis.tag] ?? axis.default}
                onChange={(event) => setAxis(axis.tag, Number(event.target.value))}
              />
            </Label>
          ))}
        </div>
      )}
      {(meta?.features?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta!.features!.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="sm"
              variant={features[tag] ? 'default' : 'outline'}
              onClick={() => setFeatures((current) => ({ ...current, [tag]: !current[tag] }))}
            >
              {FEATURE_LABELS[tag] ?? tag}
            </Button>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {missing.length} missing {missing.length === 1 ? 'character' : 'characters'}:{' '}
          {formatMissingCharacters(missing)}
        </p>
      )}
      {sourceMeta && meta && sourceMeta.format && meta.format && sourceMeta.format !== meta.format && (
        <p className="text-xs text-muted-foreground">
          Installed and source use different formats. Axis and feature controls stay independent.
        </p>
      )}
    </div>
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
  version,
}: {
  label: string
  family: string
  text: string
  size: number
  lineHeight: number
  variation: string
  features: string
  format?: string
  version?: string
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {format ? ` · ${format}` : ''}
        {version ? ` · ${version}` : ''}
      </div>
      <div
        className={cn('font-preview break-words whitespace-pre-wrap')}
        style={{
          fontFamily: `"${family}", ui-sans-serif`,
          fontSize: size,
          lineHeight,
          fontVariationSettings: variation || undefined,
          fontFeatureSettings: features || undefined,
        }}
      >
        {text}
      </div>
    </div>
  )
}

export { specimenFromSettings }

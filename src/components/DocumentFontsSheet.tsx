import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  documentFontLabel,
  documentProjectName,
  groupDocumentFonts,
  missingFontLabels,
  offAssetIds,
  type DocumentFontReport,
  type DocumentFontRow,
} from '../../shared/document-project.ts'

export function DocumentFontsSheet({
  report,
  busy,
  onClose,
  onActivateAvailable,
  onCreateProject,
}: {
  report: DocumentFontReport | null
  busy: boolean
  onClose: () => void
  onActivateAvailable: (assetIds: string[]) => void
  onCreateProject: (name: string) => void
}) {
  return (
    <Dialog
      open={report !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] w-[min(94vw,560px)] flex-col overflow-hidden">
        {report ? (
          <DocumentFontsBody
            key={report.path}
            report={report}
            busy={busy}
            onActivateAvailable={onActivateAvailable}
            onCreateProject={onCreateProject}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DocumentFontsBody({
  report,
  busy,
  onActivateAvailable,
  onCreateProject,
}: {
  report: DocumentFontReport
  busy: boolean
  onActivateAvailable: (assetIds: string[]) => void
  onCreateProject: (name: string) => void
}) {
  const groups = groupDocumentFonts(report.fonts)
  const available = offAssetIds(report.fonts)
  const missingNames = missingFontLabels(report.fonts)
  const [revealed, setRevealed] = useState(false)
  const name = documentProjectName(report.path)
  const kindLabel = documentKindLabel(report.kind)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{name}</DialogTitle>
        <DialogDescription>Fonts used in this {kindLabel}.</DialogDescription>
      </DialogHeader>
      <p className="mb-3 truncate font-mono text-[11px] text-muted-foreground" title={report.live ? 'Open documents' : report.path}>
        {report.live ? 'Open documents' : report.path}
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <FontGroup title="On" fonts={groups.on} empty="None of these faces are active." />
        <FontGroup
          title="In library, off"
          fonts={groups.off}
          empty="Nothing in the library is switched off."
        />
        <section
          id="document-missing-fonts"
          tabIndex={-1}
          data-document-group="missing"
          data-revealed={revealed ? 'true' : 'false'}
          aria-label="Missing"
          className={cn(
            'rounded-lg border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
            revealed && 'ring-2 ring-ring',
          )}
        >
          <h3 className="text-[13px] font-medium">Missing</h3>
          {groups.missing.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Every name matched a font in the library.</p>
          ) : (
            <>
              <ul className="mt-2 space-y-1">
                {groups.missing.map((font) => (
                  <li key={rowKey(font)} className="text-sm">
                    {documentFontLabel(font)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Not in the library. There is no file to show for these faces.
              </p>
            </>
          )}
        </section>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || available.length === 0}
          onClick={() => onActivateAvailable(available)}
        >
          Activate available
        </Button>
        <Button
          type="button"
          disabled={busy || report.fonts.length === 0}
          onClick={() => onCreateProject(name)}
        >
          Create project
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || missingNames.length === 0}
          onClick={() => {
            setRevealed(true)
            document.getElementById('document-missing-fonts')?.focus()
          }}
        >
          Reveal missing
        </Button>
      </div>
    </>
  )
}

function FontGroup({
  title,
  fonts,
  empty,
}: {
  title: string
  fonts: DocumentFontRow[]
  empty: string
}) {
  const group = title === 'On' ? 'on' : 'off'
  return (
    <section data-document-group={group} aria-label={title} className="rounded-lg border px-3 py-2">
      <h3 className="text-[13px] font-medium">
        {title}
        <span className="ml-2 font-normal text-muted-foreground">{fonts.length}</span>
      </h3>
      {fonts.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {fonts.map((font) => (
            <li key={rowKey(font)} className="text-sm">
              <span>{documentFontLabel(font)}</span>
              {font.postscriptName && documentFontLabel(font) !== font.postscriptName ? (
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {font.postscriptName}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function documentKindLabel(kind: DocumentFontReport['kind']): string {
  if (kind === 'pdf') return 'PDF'
  if (kind === 'idml') return 'IDML'
  if (kind === 'docx') return 'Word document'
  if (kind === 'pptx') return 'PowerPoint file'
  if (kind === 'indd') return 'InDesign document'
  if (kind === 'ai') return 'Illustrator file'
  return 'Photoshop file'
}

function rowKey(font: DocumentFontRow): string {
  return [
    font.status,
    font.assetId ?? '',
    (font.assetIds ?? []).join(','),
    font.postscriptName,
    font.familyName,
    font.styleName,
  ].join('\0')
}

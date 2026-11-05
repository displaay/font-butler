import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { Hono } from 'hono'
import { documentProjectDraft } from './document-project.ts'
import type { DocumentFontReport } from './document-fonts.ts'
import { loadProjects, saveProjects } from './projects.ts'
import { projectsPath } from './paths.ts'
import { tempPaths, withService, writeTestFont } from './test-util.ts'
import { mountDocumentFontsRoute } from '../server/document-fonts-route.ts'
import type { ProjectSet } from './types.ts'
import {
  documentPathsFrom,
  documentProjectName,
  groupDocumentFonts,
  isDocumentFontPath,
  missingFontLabels,
  offAssetIds,
  withoutDocumentPaths,
} from '../shared/document-project.ts'

test('document project draft pins the installed fingerprint and stores a missing name', () => {
  const report: DocumentFontReport = {
    path: '/docs/Brief.pdf',
    kind: 'pdf',
    fonts: [
      {
        postscriptName: 'Family-Bold',
        familyName: '',
        styleName: '',
        status: 'on',
        assetId: 'bold',
        installedFingerprint: 'fp-bold',
        matchedBy: 'postscript',
      },
      {
        postscriptName: 'Family-Regular',
        familyName: '',
        styleName: '',
        status: 'in-library-off',
        assetId: 'regular',
        matchedBy: 'postscript',
      },
      {
        postscriptName: 'OtherCut-Regular',
        familyName: 'Family',
        styleName: 'Regular',
        status: 'on',
        assetId: 'regular',
        matchedBy: 'family-style',
      },
      {
        postscriptName: 'NotInLibrary-Regular',
        familyName: '',
        styleName: '',
        status: 'missing',
        assetId: 'should-not-stick',
      },
    ],
  }
  const draft = documentProjectDraft(report)
  assert.deepEqual(draft.memberIds, ['bold', 'regular'])
  assert.deepEqual(draft.pins, { bold: 'fp-bold' })
  assert.equal('regular' in draft.pins, false)
  assert.deepEqual(draft.unresolved, [
    {
      postscriptName: 'NotInLibrary-Regular',
      familyName: '',
      styleName: '',
      sourceFile: '/docs/Brief.pdf',
    },
  ])
})

test('disagreeing fingerprints for one asset are not pinned', () => {
  const draft = documentProjectDraft({
    path: '/docs/Cuts.pdf',
    kind: 'pdf',
    fonts: [
      {
        postscriptName: 'Family-Bold',
        familyName: '',
        styleName: '',
        status: 'on',
        assetId: 'bold',
        installedFingerprint: 'fp-a',
        matchedBy: 'postscript',
      },
      {
        postscriptName: 'Family-Bold',
        familyName: '',
        styleName: '',
        status: 'on',
        assetId: 'bold',
        installedFingerprint: 'fp-b',
        matchedBy: 'postscript',
      },
    ],
  })
  assert.deepEqual(draft.memberIds, ['bold'])
  assert.deepEqual(draft.pins, {})
})

test('version 1 project files load with unresolved defaulting to an empty list', () => {
  const paths = tempPaths('font-butler-projects-v1-')
  try {
    fs.writeFileSync(
      projectsPath(paths),
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: 'p',
            name: 'Old',
            members: [{ assetId: 'a' }],
            desiredActive: false,
          },
        ],
      }),
    )
    const loaded = loadProjects(paths)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0]?.name, 'Old')
    assert.deepEqual(loaded[0]?.members, [{ assetId: 'a' }])
    assert.deepEqual(loaded[0]?.unresolved, [])
    saveProjects(paths, loaded)
    const saved = JSON.parse(fs.readFileSync(projectsPath(paths), 'utf8')) as {
      version: number
      projects: Array<{ name: string; unresolved: unknown }>
    }
    assert.equal(saved.version, 2)
    assert.equal(saved.projects[0]?.name, 'Old')
    assert.deepEqual(saved.projects[0]?.unresolved, [])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('document sheet helpers keep missing names out of activation', () => {
  const fonts = [
    { status: 'on', assetId: 'bold', postscriptName: 'Family-Bold', familyName: 'Family', styleName: 'Bold' },
    { status: 'in-library-off', assetId: 'regular', postscriptName: 'Family-Regular', familyName: '', styleName: '' },
    { status: 'missing', assetId: 'nope', postscriptName: 'NotInLibrary-Regular', familyName: '', styleName: '' },
  ]
  assert.deepEqual(offAssetIds(fonts), ['regular'])
  assert.deepEqual(missingFontLabels(fonts), ['NotInLibrary-Regular'])
  assert.deepEqual(
    groupDocumentFonts(fonts).missing.map((font) => font.postscriptName),
    ['NotInLibrary-Regular'],
  )
  assert.equal(isDocumentFontPath('/jobs/Brief.PDF'), true)
  assert.equal(isDocumentFontPath('/jobs/Brief.docx'), true)
  assert.equal(isDocumentFontPath('/jobs/Deck.pptx'), true)
  assert.equal(isDocumentFontPath('/jobs/Brief.indd'), true)
  assert.equal(isDocumentFontPath('/jobs/Brief.indt'), true)
  assert.equal(isDocumentFontPath('/jobs/Mark.ai'), true)
  assert.equal(isDocumentFontPath('/jobs/Poster.psd'), true)
  assert.equal(isDocumentFontPath('/jobs/Poster.psb'), true)
  assert.equal(isDocumentFontPath('/jobs/Board.fig'), false)
  assert.equal(documentProjectName('/jobs/Brief.indd'), 'Brief')
  assert.deepEqual(
    documentPathsFrom(['/a/Brief.pdf', '/a/Brief.docx', '/a/Face.otf', '/a/Brief.pdf']),
    ['/a/Brief.pdf', '/a/Brief.docx'],
  )
  assert.deepEqual(withoutDocumentPaths(['/a/Brief.pdf', '/a/Deck.pptx', '/a/Face.otf']), ['/a/Face.otf'])
  assert.equal(documentProjectName('/jobs/Brief.pdf'), 'Brief')
  assert.equal(documentProjectName('/jobs/Brief.docx'), 'Brief')
  assert.equal(documentProjectName('/jobs/Deck.PPTX'), 'Deck')
  assert.equal(documentProjectName('/jobs/Brief.pdf', '  Campaign  '), 'Campaign')
  assert.deepEqual(
    offAssetIds([
      { status: 'on', assetIds: ['regular'] },
      { status: 'in-library-off', assetIds: ['bold', 'italic'] },
      { status: 'missing', assetId: 'nope' },
    ]),
    ['bold', 'italic'],
  )
})

test('creating a document project pins the installed face, stores a missing name, and reports a second fingerprint as a conflict', async () => {
  await withService(async (service, paths) => {
    const regularPath = path.join(paths.dataRoot, 'Family-Regular.ttf')
    const boldPath = path.join(paths.dataRoot, 'Family-Bold.ttf')
    writeTestFont(regularPath, 'Family', 'Family-Regular')
    writeTestFont(boldPath, 'Family', 'Family-Bold', { style: 'Bold', weight: 700 })
    const imported = await service.importPaths([regularPath, boldPath])
    assert.equal(imported.errors.length, 0, imported.errors.join('\n'))
    const regular = imported.entries.find((entry) =>
      entry.faces.some((face) => face.postscriptName === 'Family-Regular'),
    )
    const bold = imported.entries.find((entry) =>
      entry.faces.some((face) => face.postscriptName === 'Family-Bold'),
    )
    assert.ok(regular)
    assert.ok(bold)
    const installed = await service.install(bold.id)
    const fp1 = installed.installedFingerprint
    assert.ok(fp1)

    const app = new Hono()
    mountDocumentFontsRoute(app, () => service.listCatalog(), {
      createProjectFromDocument: (name, report) => service.createProjectFromDocument(name, report),
    })

    async function createViaRoute(name: string, filePath: string): Promise<ProjectSet> {
      const response = await app.request('/api/documents/project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, path: filePath }),
      })
      const body = (await response.json()) as { project?: ProjectSet; error?: string }
      assert.equal(response.status, 200, body.error)
      assert.ok(body.project)
      return body.project
    }

    const pdf1 = path.join(paths.dataRoot, 'Brief.pdf')
    fs.writeFileSync(pdf1, pdfWithBaseFonts(['Family-Bold', 'Family-Regular', 'NotInLibrary-Regular']))
    const project = await createViaRoute('Brief', pdf1)
    const boldMember = project.members.find((member) => member.assetId === bold.id)
    const regularMember = project.members.find((member) => member.assetId === regular.id)
    assert.ok(boldMember)
    assert.equal(boldMember.pinFingerprint, fp1)
    assert.ok(regularMember)
    assert.equal(regularMember.pinFingerprint, undefined)
    assert.equal(project.members.length, 2)
    assert.equal(
      project.members.some((member) => member.assetId !== bold.id && member.assetId !== regular.id),
      false,
    )
    assert.deepEqual(project.unresolved, [
      {
        postscriptName: 'NotInLibrary-Regular',
        familyName: '',
        styleName: '',
        sourceFile: path.resolve(pdf1),
      },
    ])

    writeTestFont(boldPath, 'Family', 'Family-Bold', {
      style: 'Bold',
      weight: 700,
      version: 'Version 2.000',
    })
    const updated = await service.reinstall(bold.id)
    const fp2 = updated.installedFingerprint
    assert.ok(fp2)
    assert.notEqual(fp2, fp1)

    const pdf2 = path.join(paths.dataRoot, 'Other.pdf')
    fs.writeFileSync(pdf2, pdfWithBaseFonts(['Family-Bold', 'NotInLibrary-Regular']))
    const other = await createViaRoute('Other', pdf2)
    assert.equal(other.members.find((member) => member.assetId === bold.id)?.pinFingerprint, fp2)
    assert.equal(other.members.length, 1)
    assert.equal(other.unresolved?.[0]?.postscriptName, 'NotInLibrary-Regular')
    assert.equal(
      other.members.some((member) => member.assetId !== bold.id),
      false,
    )

    const activated = await service.activateProject(project.id)
    assert.equal(activated.failed, 0)
    const afterActivate = service.listCatalog().find((entry) => entry.id === bold.id)
    assert.equal(afterActivate?.installedFingerprint, fp1)
    assert.equal(
      afterActivate?.activationOwners?.some(
        (owner) => owner.kind === 'project' && owner.projectId === project.id,
      ),
      true,
    )

    await assert.rejects(() => service.activateProject(other.id), /Pinned for Brief/)

    const storedBrief = service.listProjects().find((item) => item.id === project.id)
    const storedOther = service.listProjects().find((item) => item.id === other.id)
    assert.equal(storedBrief?.desiredActive, true)
    assert.equal(storedBrief?.members.find((member) => member.assetId === bold.id)?.pinFingerprint, fp1)
    assert.equal(storedBrief?.unresolved?.[0]?.postscriptName, 'NotInLibrary-Regular')
    assert.equal(storedOther?.desiredActive, false)
    assert.equal(storedOther?.members.find((member) => member.assetId === bold.id)?.pinFingerprint, fp2)
    const finalBold = service.listCatalog().find((entry) => entry.id === bold.id)
    assert.equal(finalBold?.installedFingerprint, fp1)
    assert.equal(
      finalBold?.activationOwners?.some((owner) => owner.projectId === other.id),
      false,
    )
  })
})

function pdfWithBaseFonts(names: string[]): string {
  const objects = names.map(
    (name, index) =>
      `${index + 1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>\nendobj`,
  )
  return ['%PDF-1.4', ...objects, 'trailer << >>', '%%EOF', ''].join('\n')
}

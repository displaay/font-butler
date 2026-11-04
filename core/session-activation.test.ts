import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { FontButlerService } from './service.ts'
import { loadSessionActivationIds } from './session-activation.ts'
import { withService, writeTestFont } from './test-util.ts'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry } from './types.ts'

function entry(service: FontButlerService, id: string): CatalogEntry {
  const found = service.listCatalog().find((item) => item.id === id)
  assert.ok(found)
  return found
}

function hasOwner(item: CatalogEntry, kind: 'manual' | 'project', projectId?: string): boolean {
  return (item.activationOwners ?? []).some(
    (owner) => owner.kind === kind && (projectId === undefined || owner.projectId === projectId),
  )
}

async function setupLibrary(service: FontButlerService, paths: AppPaths) {
  const sessionFile = path.join(paths.dataRoot, 'SessionFace.ttf')
  const projectFile = path.join(paths.dataRoot, 'ProjectFace.ttf')
  const manualFile = path.join(paths.dataRoot, 'ManualFace.ttf')
  const sharedFile = path.join(paths.dataRoot, 'SharedFace.ttf')
  writeTestFont(sessionFile, 'SessionFace', 'SessionFace-Regular')
  writeTestFont(projectFile, 'ProjectFace', 'ProjectFace-Regular')
  writeTestFont(manualFile, 'ManualFace', 'ManualFace-Regular')
  writeTestFont(sharedFile, 'SharedFace', 'SharedFace-Regular')
  const imported = await service.importPaths([sessionFile, projectFile, manualFile, sharedFile])
  const byFamily = (family: string) => {
    const match = imported.entries.find((item) => item.faces[0]?.familyName === family)
    assert.ok(match, family)
    return match
  }
  const session = byFamily('SessionFace')
  const projectFace = byFamily('ProjectFace')
  const manual = byFamily('ManualFace')
  const shared = byFamily('SharedFace')
  await service.activateUntilQuit(session.id)
  await service.activateUntilQuit(shared.id)
  const project = await service.createProject('Keep', [projectFace.id, shared.id])
  await service.activateProject(project.id)
  await service.install(manual.id)
  return { session, projectFace, manual, shared, project }
}

test('session activation is recorded separately from manual and project owners', async () => {
  await withService(async (service, paths) => {
    const { session, projectFace, manual, shared, project } = await setupLibrary(service, paths)
    const recorded = loadSessionActivationIds(paths)
    assert.deepEqual(recorded.slice().sort(), [session.id, shared.id].sort())
    assert.equal(recorded.includes(projectFace.id), false)
    assert.equal(recorded.includes(manual.id), false)

    const sessionNow = entry(service, session.id)
    assert.equal(sessionNow.status, 'installed')
    assert.equal(hasOwner(sessionNow, 'manual'), false)
    assert.equal(hasOwner(sessionNow, 'project'), false)

    const sharedNow = entry(service, shared.id)
    assert.equal(sharedNow.status, 'installed')
    assert.equal(hasOwner(sharedNow, 'manual'), false)
    assert.equal(hasOwner(sharedNow, 'project', project.id), true)

    const projectNow = entry(service, projectFace.id)
    assert.equal(projectNow.status, 'installed')
    assert.equal(hasOwner(projectNow, 'manual'), false)
    assert.equal(hasOwner(projectNow, 'project', project.id), true)

    assert.equal(hasOwner(entry(service, manual.id), 'manual'), true)
    assert.equal(entry(service, manual.id).status, 'installed')
  })
})

test('quit cleanup removes session activations and leaves project and installed fonts on', async () => {
  await withService(async (service, paths) => {
    const { session, projectFace, manual, shared, project } = await setupLibrary(service, paths)
    await service.releaseSessionActivations()

    assert.deepEqual(loadSessionActivationIds(paths), [])
    assert.equal(entry(service, session.id).status, 'deactivated')
    assert.equal(hasOwner(entry(service, session.id), 'manual'), false)
    assert.equal(hasOwner(entry(service, session.id), 'project'), false)

    const sharedNow = entry(service, shared.id)
    assert.equal(sharedNow.status, 'installed')
    assert.equal(hasOwner(sharedNow, 'project', project.id), true)

    const projectNow = entry(service, projectFace.id)
    assert.equal(projectNow.status, 'installed')
    assert.equal(hasOwner(projectNow, 'manual'), false)
    assert.equal(hasOwner(projectNow, 'project', project.id), true)

    const manualNow = entry(service, manual.id)
    assert.equal(manualNow.status, 'installed')
    assert.equal(hasOwner(manualNow, 'manual'), true)
  })
})

test('the next launch clears a leftover session activation and keeps a project font', async () => {
  await withService(async (service, paths) => {
    const { session, projectFace, manual, shared, project } = await setupLibrary(service, paths)
    assert.ok(loadSessionActivationIds(paths).includes(session.id))

    const restarted = new FontButlerService(paths)
    try {
      await restarted.initCatalogPhase()
    } finally {
      restarted.dispose()
    }

    assert.deepEqual(loadSessionActivationIds(paths), [])
    assert.equal(entry(service, session.id).status, 'deactivated')
    assert.equal(entry(service, shared.id).status, 'installed')
    assert.equal(hasOwner(entry(service, shared.id), 'project', project.id), true)
    assert.equal(entry(service, projectFace.id).status, 'installed')
    assert.equal(hasOwner(entry(service, projectFace.id), 'project', project.id), true)
    assert.equal(entry(service, manual.id).status, 'installed')
    assert.equal(hasOwner(entry(service, manual.id), 'manual'), true)
  })
})

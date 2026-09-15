import fs from 'node:fs'
import path from 'node:path'
import { withService, writeTestFont } from '../../../core/test-util.ts'
import { closeFontAnalysisWorker } from '../../../core/font-analysis.ts'
import { setFontNative, noopFontNative } from '../../../core/native.ts'
import { parseFontFile, parseFontBuffer } from '../../../core/parse.ts'
import { refreshSourceStatus } from '../../../core/watch.ts'
import { onEvent } from '../../../core/events.ts'

// Keep the probe alive while the application's unref'ed parse worker runs.
const keepAlive = setInterval(() => {}, 1000)
const emit = (probe: string, value: unknown) => console.log(JSON.stringify({ probe, value }))
try {
  await withService(async (service, paths) => {
    const a = path.join(paths.sourcesDir, 'a', 'Regular.ttf')
    const b = path.join(paths.sourcesDir, 'b', 'Regular.ttf')
    writeTestFont(a, 'Parked A', 'ParkedA-Regular')
    writeTestFont(b, 'Live B', 'LiveB-Regular')
    const importedA = (await service.importPaths([a])).entries[0]!
    await service.install(importedA.id)
    const parked = await service.deactivate(importedA.id)
    const importedB = (await service.importPaths([b])).entries[0]!
    const live = await service.install(importedB.id)
    const previewBefore = parseFontBuffer(service.fontBytesForEntry(parked.id).buffer)
    emit('parked-preview', previewBefore)
    await service.uninstall(parked.id)
    emit('uninstall-parked-reused-name', {
      rememberedPath: parked.installedPath,
      livePath: live.installedPath,
      liveFileStillExists: fs.existsSync(live.installedPath!),
      liveCatalogStatus: service.listCatalog().find(e => e.id === live.id)?.status,
      sourceBStillExists: fs.existsSync(b),
    })
  }).catch(error => emit('uninstall-parked-probe-error', String(error)))

  await withService(async (service, paths) => {
    const a = path.join(paths.sourcesDir, 'Alpha.ttf')
    const b = path.join(paths.sourcesDir, 'Beta.ttf')
    writeTestFont(a, 'Alpha', 'Alpha-Regular')
    writeTestFont(b, 'Beta', 'Beta-Regular')
    const rows = (await service.importPaths([a,b])).entries
    for (const row of rows) await service.install(row.id)
    const beforeActivity = service.listActivity().map(o => o.id)
    const second = service.listCatalog().find(e => e.id === rows[1]!.id)!
    const events: string[] = []
    const stop = onEvent(e => events.push(e.type))
    setFontNative(noopFontNative({ unregisterFont: async file => {
      if (file === second.installedPath) throw new Error('Injected native unregister failure')
      return { ok: true, native: false }
    }}))
    let error = ''
    try { await service.uninstallMany(rows.map(e => e.id)) } catch (e) { error = String(e) }
    stop()
    emit('partial-uninstall', {
      error, statuses: rows.map(row => service.listCatalog().find(e=>e.id===row.id)?.status),
      newActivity: service.listActivity().filter(o => !beforeActivity.includes(o.id)), events,
    })
  })

  await withService(async (service, paths) => {
    const a = path.join(paths.sourcesDir, 'IdentityA.ttf')
    const b = path.join(paths.sourcesDir, 'IdentityB.ttf')
    writeTestFont(a, 'Identity A', 'IdentityA-Regular')
    writeTestFont(b, 'Identity B', 'IdentityB-Regular')
    const rows = (await service.importPaths([a,b])).entries
    for (const row of rows) await service.install(row.id)
    fs.copyFileSync(b, a)
    await refreshSourceStatus(paths, a)
    let error = ''
    try { await service.reinstall(rows[0]!.id) } catch (e) { error = String(e) }
    emit('source-identity-change', {
      error,
      liveIdentities: service.listCatalog().filter(e => e.installedPath && fs.existsSync(e.installedPath)).map(e => ({ id:e.id, ps: parseFontFile(e.installedPath!).faces.map(f=>f.postscriptName) })),
    })
  })

  await withService(async (service, paths) => {
    fs.mkdirSync(paths.adobeFontsDir, {recursive:true})
    const source = path.join(paths.sourcesDir, 'Adobe.ttf')
    writeTestFont(source, 'Adobe Park', 'AdobePark-Regular')
    const row = (await service.importPaths([source])).entries[0]!
    await service.install(row.id, undefined, {destinationIds:['adobe-shared']})
    const parked = await service.deactivate(row.id)
    const retained = parked.installations?.find(c=>c.destinationId==='adobe-shared')?.parkedPath
    await service.uninstall(row.id)
    emit('adobe-parked-uninstall', {retainedFileStillExists: !!retained && fs.existsSync(retained), entry:service.listCatalog().find(e=>e.id===row.id)})
  })

  await withService(async (service, paths) => {
    fs.mkdirSync(paths.adobeFontsDir, {recursive:true})
    const source = path.join(paths.sourcesDir, 'Both.ttf')
    writeTestFont(source, 'Both Requested', 'BothRequested-Regular')
    const row = (await service.importPaths([source])).entries[0]!
    // An unrelated same-identity Adobe copy makes the second destination fail.
    fs.copyFileSync(source, path.join(paths.adobeFontsDir, 'Unmanaged.ttf'))
    let error = ''
    let result
    try { result = await service.install(row.id, undefined, {destinationIds:['macos','adobe-shared']}) } catch (e) { error = String(e) }
    emit('partial-destination-install', {error, destinations:result?.installations, activity:service.listActivity()[0]})
  })
} finally {
  await closeFontAnalysisWorker()
  clearInterval(keepAlive)
}

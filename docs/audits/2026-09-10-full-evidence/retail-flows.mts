// Audit reproduction: run from the repository root with FONT_BUTLER_TEST=1.
// Fonts and catalogs are temporary; native operations are mocked. No production fixes are applied.
import fs from 'node:fs'
import path from 'node:path'
import { withService, writeTestFont } from '../../../core/test-util.ts'
import { checkRetail, configureRetailSync, resetRetailCache, syncRetail } from '../../../core/service-retail.ts'
import { loadCatalog } from '../../../core/catalog.ts'
import { tryFingerprintFile } from '../../../core/fingerprint.ts'
import { loadProjects } from '../../../core/projects.ts'
const manifest = (bytes, version = 1) => ({generatedAt:'2026-01-01', collections:[{glyphsFile:'Audit', revisionId:'r'+version,lastRegeneratedAt:null,files:[{key:`Audit/r${version}/Audit.otf`,relativePath:'Audit/Audit.otf',size:bytes.length,etag:'e'+version,uploaded:'2026-01-01'}]}],skipped:[]})
async function seed(paths) {
  const src=path.join(paths.dataRoot,'fixture.otf');writeTestFont(src,'Audit','Audit-Regular',{format:'otf'});const bytes=fs.readFileSync(src)
  configureRetailSync(paths,{enabled:true,token:'stub-only'})
  await syncRetail(paths,{fetchManifest:async()=>manifest(bytes),fetchFile:async()=>bytes})
  const entry=loadCatalog(paths).entries.find(e=>e.retailRelativePath)
  writeTestFont(src,'Audit','Audit-Regular',{format:'otf',version:'Version 2.000'});const next=fs.readFileSync(src)
  return {entry,bytes,next}
}
await withService(async(service,paths)=>{
 resetRetailCache();const {entry,next}=await seed(paths);await service.deactivate(entry.id)
 const before=loadCatalog(paths).entries.find(e=>e.id===entry.id)
 await syncRetail(paths,{fetchManifest:async()=>manifest(next,2),fetchFile:async()=>next})
 const after=loadCatalog(paths).entries.find(e=>e.id===entry.id)
 console.log('DEACTIVATED:',JSON.stringify({before:{status:before.status,live:before.installedPath},after:{status:after.status,live:after.installedPath,disabled:after.disabledPath}}))
})
await withService(async(service,paths)=>{
 resetRetailCache();const {entry,bytes,next}=await seed(paths);await service.install(entry.id)
 const installed=loadCatalog(paths).entries.find(e=>e.id===entry.id);const fingerprint=installed.installedFingerprint
 const project=await service.createProject('Audit pinned',[entry.id]);await service.updateProject(project.id,{pin:{assetId:entry.id,fingerprint}});await service.activateProject(project.id)
 const synced=await syncRetail(paths,{fetchManifest:async()=>manifest(next,2),fetchFile:async()=>next})
 const after=loadCatalog(paths).entries.find(e=>e.id===entry.id)
 console.log('PIN:',JSON.stringify({error:synced.error,oldFingerprint:fingerprint,recorded:after.installedFingerprint,actual:tryFingerprintFile(after.installedPath),active:loadProjects(paths)[0].desiredActive,pin:loadProjects(paths)[0].members[0].pinFingerprint}))
})
await withService(async(service,paths)=>{
 resetRetailCache();const {entry,next}=await seed(paths);let started;const begun=new Promise(resolve=>started=resolve);let release;const gate=new Promise(resolve=>release=resolve)
 const syncing=syncRetail(paths,{fetchManifest:async()=>manifest(next,2),fetchFile:async()=>{started();await gate;return next}})
 await begun;await service.uninstall(entry.id);const removed=loadCatalog(paths).entries.find(e=>e.id===entry.id);release();const synced=await syncing;const after=loadCatalog(paths).entries.find(e=>e.id===entry.id)
 console.log('RACE:',JSON.stringify({uninstallStatus:removed.status,statusAfterDownload:after.status,error:synced.error,exists:fs.existsSync(after.installedPath)}))
})

import fs from 'node:fs'
import path from 'node:path'
import { withService, writeTestFont } from '../../../core/test-util.ts'
import { closeFontAnalysisWorker } from '../../../core/font-analysis.ts'
import { configureRetailSync, resetRetailCache, syncRetail } from '../../../core/service-retail.ts'
import { fingerprintFile } from '../../../core/fingerprint.ts'
import type { RetailManifest } from '../../../shared/retail.ts'

const keepAlive=setInterval(()=>{},1000)
try {
  await withService(async(service,paths)=>{
    resetRetailCache()
    await configureRetailSync(paths,{enabled:true,workerBaseUrl:'https://audit.invalid',token:'synthetic-audit-token'})
    const build=(version:number)=>{
      const bytes=new Map<string,Uint8Array>()
      for(const family of ['RaceA','RaceB']) {
        const file=path.join(paths.sourcesDir,`${family}-v${version}.ttf`)
        writeTestFont(file,family,`${family}-Regular`,{version:`Version ${version}.000`})
        bytes.set(family,fs.readFileSync(file))
      }
      const manifest:RetailManifest={generatedAt:new Date().toISOString(),skipped:[],collections:[...bytes].map(([family,data])=>({
        glyphsFile:family,revisionId:`v${version}`,lastRegeneratedAt:new Date().toISOString(),files:[{
          key:`${family}/v${version}/${family}.ttf`,relativePath:`${family}/${family}.ttf`,size:data.length,
          etag:`${family}-${version}`,uploaded:new Date().toISOString(),
        }],
      }))}
      return {bytes,manifest}
    }
    const v1=build(1),v2=build(2)
    await syncRetail(paths,{fetchManifest:async()=>v1.manifest,fetchFile:async({key})=>v1.bytes.get(key.split('/')[0]!)!})
    const first=service.listCatalog().find(e=>e.retailRelativePath==='RaceA/RaceA.ttf')!
    const beforeHash=fingerprintFile(first.installedPath!)
    let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve})
    const syncing=syncRetail(paths,{
      fetchManifest:async()=>v2.manifest,
      fetchFile:async({key})=>{
        if(key.startsWith('RaceB/'))await gate
        return v2.bytes.get(key.split('/')[0]!)!
      },
    })
    const deadline=Date.now()+5000
    while(Date.now()<deadline && fingerprintFile(first.installedPath!)===beforeHash) {
      await new Promise(resolve=>setTimeout(resolve,10))
    }
    if(fingerprintFile(first.installedPath!)===beforeHash)throw new Error('First write did not arrive')
    await service.uninstall(first.id)
    const afterUninstall=service.listCatalog().find(e=>e.id===first.id)!
    release()
    const synced=await syncing
    const afterSync=service.listCatalog().find(e=>e.id===first.id)!
    console.log(JSON.stringify({probe:'retail-same-batch-uninstall',value:{
      afterUninstall:afterUninstall.status,afterSync:afterSync.status,
      recordedInstalledPath:afterSync.installedPath,
      fileStillExists:!!afterSync.installedPath&&fs.existsSync(afterSync.installedPath),
      error:synced.error,
    }}))
  })
} finally {
  await closeFontAnalysisWorker()
  clearInterval(keepAlive)
}

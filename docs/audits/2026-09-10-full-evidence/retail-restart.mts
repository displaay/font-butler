// Audit reproduction: run from the repository root with FONT_BUTLER_TEST=1.
// Fonts and catalogs are temporary; native operations are mocked. No production fixes are applied.
import fs from 'node:fs'
import path from 'node:path'
import { withService, writeTestFont, tempPaths } from '../../../core/test-util.ts'
import { FontButlerService } from '../../../core/service.ts'
import { configureRetailSync, resetRetailCache, syncRetail, checkRetail } from '../../../core/service-retail.ts'
import { loadCatalog } from '../../../core/catalog.ts'
import { noopFontNative,setFontNative } from '../../../core/native.ts'
import { spawnSync } from 'node:child_process'
import { closeAllWatchers } from '../../../core/watch.ts'
const isChild = process.argv[2] === 'child'
const paths = isChild ? JSON.parse(fs.readFileSync(process.argv[3],'utf8')) : tempPaths('font-butler-audit-crash-')
const fixture = path.join(paths.dataRoot,'fixture.otf')
if (!isChild) for(let i=0;i<5;i++) writeTestFont(path.join(paths.dataRoot,'fixture-'+i+'.otf'),'Audit','Audit-'+i,{format:'otf',style:'Style'+i})
const fontBytes=Array.from({length:5},(_,i)=>fs.readFileSync(path.join(paths.dataRoot,'fixture-'+i+'.otf')))
const bytes=fontBytes[0]
const manifest = {generatedAt:'2026-01-01',collections:[{glyphsFile:'Audit',revisionId:'r1',lastRegeneratedAt:null,files:Array.from({length:5},(_,i)=>({key:`Audit/r1/Audit-${i}.otf`,relativePath:`Audit/Audit-${i}.otf`,size:fontBytes[i].length,etag:'e1',uploaded:'2026-01-01'}))}],skipped:[]}
setFontNative(noopFontNative())
resetRetailCache()
configureRetailSync(paths,{enabled:true,token:'stub-only'})
if(isChild){
 await syncRetail(paths,{fetchManifest:async()=>manifest,fetchFile:async({key})=>{if(key.includes('-4.'))process.exit(99);return fontBytes[Number(key.match(/-(\d)\.otf$/)[1])]}})
}else{
 try{
  const pathsFile=path.join(paths.dataRoot,'paths.json');fs.writeFileSync(pathsFile,JSON.stringify(paths))
  const child=spawnSync(process.execPath,['--import','tsx',import.meta.filename,'child',pathsFile],{cwd:process.cwd(),env:process.env,encoding:'utf8'})
  console.log('CHILD',child.status,child.stderr)
  const service=new FontButlerService(paths);await service.init();
  const result=await syncRetail(paths,{fetchManifest:async()=>manifest,fetchFile:async({key})=>fontBytes[Number(key.match(/-(\d)\.otf$/)[1])]})
  service.dispose();await closeAllWatchers()
  const rows=loadCatalog(paths).entries.map(e=>({file:e.retailRelativePath,status:e.status,sourcePath:e.sourcePath,installedPath:e.installedPath,fontExists:fs.existsSync(path.join(paths.userFontsDir,path.basename(e.retailRelativePath||e.installedPath||'missing')))}))
  console.log('RESUME',JSON.stringify({error:result.error,pending:result.pending,rows}))
 }finally{fs.rmSync(paths.dataRoot,{recursive:true,force:true})}
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeTestFont } from '../../../core/test-util.ts'
import { FontButlerService } from '../../../core/service.ts'
import { setFontNative, noopFontNative } from '../../../core/native.ts'
import { buildPaths } from '../../../core/paths.ts'
import { closeAllWatchers } from '../../../core/watch.ts'
import { startFontButlerServer } from '../../../server/index.ts'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'font-butler-audit-ui-'))
process.env.FONT_BUTLER_DATA=root
const paths=buildPaths({override:root,mac:true})
setFontNative(noopFontNative())
const keepAlive=setInterval(()=>{},1000)
const seed=new FontButlerService(paths)
await seed.updateSettings({onboardingCompleted:true,installAfterUpload:false})
for(const family of ['Atlas','Beacon','Cedar','Delta','Ember']) {
  for(const style of ['Regular','Bold']) {
    const source=path.join(paths.sourcesDir,`${family}-${style}.ttf`)
    writeTestFont(source,family,`${family}-${style}`,{style,codePoints:[65,66,67,97,98,99]})
    const row=(await seed.importPaths([source])).entries[0]!
    if(family!=='Ember')await seed.install(row.id)
    if(family==='Delta')await seed.deactivate(row.id)
  }
}
seed.dispose()
await closeAllWatchers()
const info=await startFontButlerServer({port:43292,staticDir:path.resolve('dist')})
console.log(JSON.stringify({root,port:info.port}))
clearInterval(keepAlive)

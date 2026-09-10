// Audit reproduction: run from the repository root with FONT_BUTLER_TEST=1.
// Fonts and catalogs are temporary; native operations are mocked. No production fixes are applied.
import fs from 'node:fs'; import path from 'node:path';
import {withService,writeTestFont} from '../../../core/test-util.ts';
await withService(async(service,paths)=>{
const snap=(name)=>console.log(name,service.listCatalog().map(e=>({id:e.id,status:e.status,source:e.sourcePath,live:e.installedPath,parked:e.disabledPath,parkedExists:e.disabledPath&&fs.existsSync(e.disabledPath)})));
const a=path.join(paths.dataRoot,'a/Regular.ttf');const b=path.join(paths.dataRoot,'b/Regular.ttf');
writeTestFont(a,'Audit','Audit-Regular');const first=(await service.importPaths([a])).entries[0];await service.install(first.id);writeTestFont(a,'Audit','Audit-Regular',{version:'Version 2.000'});await service.reinstall(first.id);await service.deactivate(first.id);snap('PARKED');
writeTestFont(b,'Audit','Audit-Regular',{version:'Version 3.000'});const second=(await service.importPaths([b])).entries[0];snap('IMPORTED SECOND');await service.install(second.id);snap('INSTALLED SECOND');
try{await service.restoreRevision(first.id)}catch(e){console.log('RESTORE ERROR',e.message)}
});

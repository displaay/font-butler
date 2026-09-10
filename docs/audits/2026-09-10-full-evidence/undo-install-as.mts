// Audit reproduction: run from the repository root with FONT_BUTLER_TEST=1.
// Fonts and catalogs are temporary; native operations are mocked. No production fixes are applied.
import fs from 'node:fs';
import path from 'node:path';
import {withService,writeTestFont} from '../../../core/test-util.ts';
import {parseFontFile} from '../../../core/parse.ts';
await withService(async(service,paths)=>{
 const file=path.join(paths.dataRoot,'Original.ttf'); writeTestFont(file,'Original','Original-Regular');
 const original=(await service.importPaths([file])).entries[0];
 await service.install(original.id);
 const renamed=await service.install(original.id,'Renamed');
 const op=service.listActivity()[0];
 console.log('install-as operation',op.action,op.items.map(x=>({entryId:x.entryId,previousRevision:x.previousRevision})));
 const undo=await service.undoOperation(op.id);
 console.log('undo',undo.succeeded,undo.failed,undo.errors);
 console.log('catalog',service.listCatalog().map(x=>({id:x.id,path:x.installedPath,status:x.status,names:x.faces.map(f=>f.postscriptName),actualNames:x.installedPath&&fs.existsSync(x.installedPath)?parseFontFile(x.installedPath).faces.map(f=>f.postscriptName):[]})));
});

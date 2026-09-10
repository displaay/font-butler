// Audit reproduction: run from the repository root with FONT_BUTLER_TEST=1.
// Fonts and catalogs are temporary; native operations are mocked. No production fixes are applied.
import fs from 'node:fs';
import path from 'node:path';
import {withService,writeTestFont,writeTestWebFont} from '../../../core/test-util.ts';
import {syncInboxWatcher,listInboxFontFiles,closeAllWatchers} from '../../../core/watch.ts';

await withService(async(service,paths)=>{
 const a=path.join(paths.dataRoot,'a.ttf'); const b=path.join(paths.dataRoot,'b.ttf');
 writeTestFont(a,'Switch','Switch-Regular',{version:'Version 1.000'}); writeTestFont(b,'Switch','Switch-Regular',{version:'Version 2.000'});
 const original=(await service.importPaths([a])).entries[0]; await service.install(original.id);
 const plan=service.planImport([b]);
 const result=await service.applyPlan(plan.id,{[plan.items[0].id]:'switch'});
 const before=service.listCatalog().map(x=>({id:x.id,status:x.status,path:x.installedPath}));
 const undo=await service.undoOperation(result.operationId);
 console.log('switch-plan undo',JSON.stringify({before,undo:{succeeded:undo.succeeded,failed:undo.failed,errors:undo.errors},after:service.listCatalog().map(x=>({id:x.id,status:x.status,path:x.installedPath}))}));
});

await withService(async(service,paths)=>{
 const a=path.join(paths.dataRoot,'a.ttf');writeTestFont(a,'AdobeRemoval','AdobeRemoval-Regular');
 fs.mkdirSync(paths.adobeFontsDir,{recursive:true});
 const original=(await service.importPaths([a])).entries[0];
 const installed=await service.install(original.id,undefined,{destinationIds:['adobe-shared']});
 const adobe=installed.installations!.find(x=>x.destinationId==='adobe-shared')!.path;
 const rm=fs.rmSync;
 fs.rmSync=((p:any,options:any)=>{if(path.resolve(String(p))===path.resolve(adobe))throw Object.assign(new Error('injected EACCES'),{code:'EACCES'});return rm(p,options)}) as typeof fs.rmSync;
 try{const result=await service.uninstall(original.id);console.log('failed Adobe unlink',JSON.stringify({fileStillExists:fs.existsSync(adobe),status:result.status,installations:result.installations,operation:service.listActivity()[0].outcome}));}
 finally{fs.rmSync=rm;}
});

await withService(async(service,paths)=>{
 const dir=path.join(paths.dataRoot,'watch');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(paths.adobeFontsDir,{recursive:true});
 await service.updateSettings({defaultDestination:'adobe-shared'});
 await service.configureFolder({root:dir,destinationId:'macos',installNew:true});
 const a=path.join(dir,'a.ttf');writeTestFont(a,'FolderMac','FolderMac-Regular');
 const original=(await service.importPaths([a])).entries[0];
 const installed=await service.install(original.id);
 console.log('explicit Mac folder',JSON.stringify({folder:service.getSettings().folders[0].destinationId,global:service.getSettings().defaultDestination,destinations:installed.installations?.map(x=>x.destinationId)}));
});

await withService(async(service,paths)=>{
 const dir=path.join(paths.dataRoot,'watch');fs.mkdirSync(dir,{recursive:true}); const events:string[]=[];
 await syncInboxWatcher([dir],files=>events.push(...files));
 await new Promise(r=>setTimeout(r,500));
 const a=path.join(dir,'LiveWeb.woff');writeTestWebFont(a,'LiveWeb','LiveWeb-Regular');
 await new Promise(r=>setTimeout(r,1400));
 console.log('live web',JSON.stringify({eventFiles:events.map(x=>path.basename(x)),initialScan:listInboxFontFiles(dir).map(x=>path.basename(x))}));
});

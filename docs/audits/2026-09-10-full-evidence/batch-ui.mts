// Audit reproduction: run from the repository root with FONT_BUTLER_TEST=1.
// Fonts and catalogs are temporary; native operations are mocked. No production fixes are applied.
// oxlint-disable react-hooks/rules-of-hooks -- this fixture invokes the hook directly to exercise its action handlers.
import {useFontActions} from '../../../src/hooks/useFontActions.ts';
import {api} from '../../../src/lib/api.ts';
import {toast} from 'sonner';
import {groupCatalog} from '../../../src/lib/group.ts';
const entries=['Regular','Bold'].map((style,i)=>({id:String(i),status:'uninstalled',sourcePath:'/tmp/'+style+'.ttf',sourcePresent:true,sourceAvailability:'present',format:'ttf',faces:[{familyName:'Batch Audit',styleName:style,postscriptName:'BatchAudit-'+style,weight:400,isVariable:false,instanceCount:1}],addedAt:1,updatedAt:1}));
const groups=groupCatalog(entries);
const outcome={entries:[entries[0]],succeeded:1,failed:1,failedIds:['1'],errors:['missing source']};
api.installMany=async()=>outcome;
api.catalog=async()=>({entries});api.activity=async()=>({operations:[]});
const observed=[];toast.success=(message,options)=>{observed.push({message,action:options?.action?.label});return 1};toast.error=(message)=>{observed.push({error:message});return 1};
const noop=()=>{};
const actions=useFontActions({entries,operations:[],setEntries:noop,setSystemFaces:noop,setOperations:noop,busyRef:{current:false},setBusy:noop,setActionStatus:noop,setTab:noop,setWatchFolderFilter:noop,setHighlightOperation:noop,selectedCatalogGroups:()=>groups,selectedSystemList:()=>[],tab:'library',allUpdates:[],setFormatPrompt:noop,setReplacePrompt:noop});
await actions.installSelected();console.log(JSON.stringify({backend:outcome,observed}));

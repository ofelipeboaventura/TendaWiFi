// Explicit active diagnostic validation. Does not optimize or change network configuration.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
if (!process.argv.includes('--active-diagnostic')) throw Error('Use --active-diagnostic to run one diagnostic on the configured router.');
fs.mkdirSync('artifacts/monitoring', {recursive:true});
await build({stdin:{contents:"export {RouterClient} from './src/main/router'; export {AppService} from './src/main/service'; export {loadAutoLoginConfig} from './src/main/auto-login'; export {parseDiagnostic} from './src/main/monitoring/diagnostics';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:'artifacts/monitoring/diagnostic-client.cjs'});
const {RouterClient,AppService,loadAutoLoginConfig,parseDiagnostic}=createRequire(import.meta.url)('../artifacts/monitoring/diagnostic-client.cjs');
const client=new RouterClient(),service=new AppService({clear(){}},()=>client,client);
const report={success:false,actions:[],states:[],samples:0};
const write=client.writeModules.bind(client), read=client.readModules.bind(client);
report.observations=[];
client.readModules=async(...args)=>{const response=await read(...args);const d=response.syschkInfo;if(d&&report.observations.length<8)report.observations.push({type:d.check_type,progress:d.progress_rate,items:Array.isArray(d.data)?d.data.map(r=>({name:r.item_name,status:r.item_status,result:r.result})):[]});return response;};
client.writeModules=async payload=>{
  const p=payload.syschkInfo;
  if(Object.keys(payload).length!==1||!p||Object.keys(p).length!==2||p.operation_name!=='check'||!['init','start','stop'].includes(p.operation_action))throw Error('Unexpected mutation rejected by validation harness.');
  report.actions.push(p.operation_action);return write(payload);
};
let config;
try{
  report.phase='configuration';config=await loadAutoLoginConfig(process.cwd());if(!config)throw Error('Missing local login configuration.');
  report.phase='authentication';await client.connect(config.host,config.password);config.password='';
  report.phase='initial-telemetry';const first=await service.readMonitoring(true,true);report.model=client.getConnection().model;report.firmware=client.getConnection().firmware;
  report.previousResultKnown=first.resources.some(r=>r.cpu!==null||r.memory!==null);
  if(process.argv.includes('--inspect-only')){report.success=true;report.phase='inspection';}
  else {
  report.phase='diagnostic';await service.setResourceDiagnostics(true);
  const deadline=Date.now()+125000;
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const r=await service.readMonitoring(false,false),status=r.diagnostic;
    const entry={status:status?.status,progress:status?.progress};
    if(JSON.stringify(entry)!==JSON.stringify(report.states.at(-1)))report.states.push(entry);
    report.samples++;
    if(r.resourceSample){
      const reference=parseDiagnostic((await client.readModules(['syschkInfo'])).syschkInfo);
      report.resource={cpu:r.resourceSample.cpu,memory:r.resourceSample.memory,observedAt:r.resourceSample.at};
      report.matchesOriginalFields=reference.cpu===r.resourceSample.cpu&&reference.memory===r.resourceSample.memory;
      report.success=report.matchesOriginalFields&&report.actions.filter(a=>a==='start').length===1;break;
    }
    if(['external','unavailable','disabled'].includes(status?.status))break;
  }
  }
}catch(error){report.error={code:typeof error.code==='string'?error.code:'DIAGNOSTIC_CHECK',message:'Diagnostic validation did not complete; credentials and raw responses omitted.'};}
finally{
  if(config)config.password='';
  await service.setResourceDiagnostics(false);await service.shutdown();
  fs.writeFileSync('artifacts/monitoring/diagnostic-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(!report.success)process.exitCode=1;
}

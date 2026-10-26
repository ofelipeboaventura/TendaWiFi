// Authenticated reads + fixed ICMP/DNS probes only. No configuration setters or active diagnostic.
import {build} from 'esbuild';
import fs from 'node:fs';
import {createRequire}from'node:module';
if(!process.argv.includes('--read-only-live'))throw Error('Explicit --read-only-live is required.');
fs.mkdirSync('artifacts/observability',{recursive:true});
await build({stdin:{contents:"export {RouterClient} from './src/main/router'; export {AppService} from './src/main/service'; export {loadAutoLoginConfig} from './src/main/auto-login'; export {VolumeTracker} from './src/main/monitoring/volumes'; export {ExtraQuality} from './src/main/monitoring/extra-quality';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:'artifacts/observability/audit.cjs'});
const{RouterClient,AppService,loadAutoLoginConfig,VolumeTracker,ExtraQuality}=createRequire(import.meta.url)('../artifacts/observability/audit.cjs');
const client=new RouterClient(),service=new AppService({clear(){}},()=>client,client),volumes=new VolumeTracker(),extra=new ExtraQuality();const report={success:false,readOnly:true,rounds:[],dns:[]};let config;
client.writeModules=async()=>{throw Error('Router mutations are blocked by this read-only audit.');};
try{
  config=await loadAutoLoginConfig(process.cwd());if(!config)throw Error('Local login configuration is missing.');await client.connect(config.host,config.password);config.password='';
  let last;
  for(let i=0;i<3;i++){const started=performance.now(),r=await service.readMonitoring(i===0,false,i===0),at=Date.now(),slices=volumes.update(r,at,performance.now(),1000,true,[]);last=r;report.rounds.push({milliseconds:Math.round(performance.now()-started),nodes:r.nodes.length,clients:r.clients.filter(d=>d.online).length,validRates:[r.overview.upload,r.overview.download].every(n=>Number.isFinite(n)&&n>=0),estimatedWan:slices.find(v=>v.entity==='wan')?{...slices.find(v=>v.entity==='wan'),entity:'wan'}:null});if(i<2)await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000-(performance.now()-started))));}
  report.radios=last.radios;report.rssiPresent=last.clients.filter(d=>d.rssi!==null&&d.rssi!==undefined&&d.rssi!=='').length;report.negotiatedRatePresent=last.clients.filter(d=>d.negotiatedMbps!=null).length;
  await new Promise(resolve=>{const timer=setTimeout(resolve,6000);extra.start(config.host,last.nodes,rows=>{report.dns.push(...rows.filter(r=>r.kind==='dns').map(r=>({...r,target:r.target===config.host?'router':r.target})));if(report.dns.length>=2){clearTimeout(timer);resolve();}});});
  report.success=report.rounds.length===3&&report.rounds.every(r=>r.validRates)&&report.rounds.some(r=>r.estimatedWan?.basis==='estimated')&&report.radios?.length===3&&report.dns.length>=2;
}catch(error){report.error={code:typeof error.code==='string'?error.code:'AUDIT',message:'Read-only validation did not complete. Raw responses and credentials omitted.'};}
finally{extra.stop();if(config)config.password='';await service.shutdown();fs.writeFileSync('artifacts/observability/live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.success)process.exitCode=1;}

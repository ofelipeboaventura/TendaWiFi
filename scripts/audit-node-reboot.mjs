// Authenticated identification reads only. Reboot, diagnostic and all router writes are blocked.
import {build}from'esbuild';
import fs from'node:fs';
import{createRequire}from'node:module';
if(!process.argv.includes('--read-only-live'))throw Error('Explicit --read-only-live is required.');
fs.mkdirSync('artifacts/node-reboot',{recursive:true});
await build({stdin:{contents:"export {RouterClient} from './src/main/router';export {loadAutoLoginConfig} from './src/main/auto-login';export {resolveRebootTarget} from './src/main/reboot-target';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:'artifacts/node-reboot/audit.cjs'});
const{RouterClient,loadAutoLoginConfig,resolveRebootTarget}=createRequire(import.meta.url)('../artifacts/node-reboot/audit.cjs');
const router=new RouterClient();router.writeModules=async()=>{throw Error('Router writes are blocked.');};let config;
const report={success:false,readOnly:true,nodes:[]};
try{config=await loadAutoLoginConfig(process.cwd());if(!config)throw Error('No local login configuration.');await router.connect(config.host,config.password);config.password='';
  const nodes=await router.mesh();
  for(const node of nodes){const row={primary:node.primary,online:node.online,modalIpPresent:!!node.ip,ready:false};if(node.online){try{const target=await resolveRebootTarget(router,node);row.ready=true;row.macResolved=!!target.mac;row.ipResolved=!!target.ip;}catch(error){row.error=typeof error.code==='string'?error.code:'AUDIT';row.reason=error.message;}
  }report.nodes.push(row);if(!router.getConnection().connected)break;}
  report.success=nodes.length>0&&report.nodes.length===nodes.length&&router.getConnection().connected;report.allOnlineReady=report.success&&report.nodes.filter(node=>node.online).every(node=>node.ready);
}catch(error){report.error=typeof error.code==='string'?error.code:'AUDIT';}
finally{if(config)config.password='';await router.disconnect();fs.writeFileSync('artifacts/node-reboot/live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.success)process.exitCode=1;}

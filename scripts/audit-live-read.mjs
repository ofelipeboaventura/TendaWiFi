import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs';
await build({stdin:{contents:"export {RouterClient} from './src/main/router/index';export {loadAutoLoginConfig} from './src/main/auto-login';export {catalog,getPath} from './src/main/features/catalog';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:'artifacts/diagnostics/read-audit.cjs'});
const require=createRequire(import.meta.url);const {RouterClient,loadAutoLoginConfig,catalog,getPath}=require('../artifacts/diagnostics/read-audit.cjs');
const client=new RouterClient(),results=[];let config;
try{
  config=await loadAutoLoginConfig(process.cwd());if(!config)throw Error('Login automático não configurado.');
  await client.connect(config.host,config.password);config.password='';
  for(const spec of catalog){const modules=[...new Set([...spec.fields.map(f=>f.key.split('.')[0]),...(spec.tables??[]).map(t=>t.key.split('.')[0]),...(spec.related??[])])];try{const raw=await client.readModules(modules,spec.id==='cloud'?{action:'basic'}:undefined);results.push({id:spec.id,success:true,missingFields:spec.fields.filter(f=>getPath(raw,f.key)===undefined).map(f=>f.key),enumMismatches:spec.fields.filter(f=>f.type==='select'&&!f.secret&&getPath(raw,f.key)!==undefined&&!f.schema.safeParse(String(getPath(raw,f.key))).success).map(f=>({key:f.key,value:String(getPath(raw,f.key))})),tableTypes:(spec.tables??[]).map(t=>({key:t.key,isArray:Array.isArray(getPath(raw,t.key))}))});}catch(error){results.push({id:spec.id,success:false,code:error.code,message:error.message});}}
}catch(error){console.log(JSON.stringify({success:false,code:error.code,message:error.message}));process.exitCode=1;}
finally{if(config)config.password='';await client.disconnect();}
fs.writeFileSync('artifacts/live-read-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
await build({ stdin: { contents: "export {RouterClient} from './src/main/router/index'; export {httpTransport} from './src/main/router/transport'; export {loadAutoLoginConfig} from './src/main/auto-login';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: 'artifacts/diagnostics/env-client.cjs' });
const require = createRequire(import.meta.url);
const { RouterClient, httpTransport, loadAutoLoginConfig } = require('../artifacts/diagnostics/env-client.cjs');
const steps = [];
let issuedStok='';
const client = new RouterClient({ transport: async request => {
  const phase = request.path.startsWith('/goform/loginInfo') ? 'Estado do login' : request.path === '/login/Auth' ? 'Autenticação' : request.path.includes('/goform/stokCfg') ? 'Validação da sessão' : request.path.startsWith('/js/') ? 'Identificação do equipamento' : 'Consulta de dados';
  try { const response = await httpTransport(request); let value; try { value = JSON.parse(response.body.toString('utf8')); } catch {} if(value?.stokCfg?.stok)issuedStok=value.stokCfg.stok; const cookies=response.headers['set-cookie']; const cookieNames=(Array.isArray(cookies)?cookies:typeof cookies==='string'?[cookies]:[]).map(c=>c.split('=',1)[0]); steps.push({ phase, status: response.status, bytes: response.body.length, encrypted: typeof value?.data === 'string', serverCode: typeof value?.errCode === 'number' ? value.errCode : undefined, cookieNames, bootstrap: value?.stokCfg ? {keys:Object.keys(value.stokCfg),signLength:typeof value.stokCfg.sign==='string'?value.stokCfg.sign.length:0,stokLength:typeof value.stokCfg.stok==='string'?value.stokCfg.stok.length:0}:undefined }); return response; }
  catch(error) { steps.push({phase,status:error.httpStatus,failure:typeof error.code==='string'?error.code:'OFFLINE',issuedTokenUsed:issuedStok?request.path.includes('/;stok='+encodeURIComponent(issuedStok)+'/'):undefined,hasCookie:Boolean(request.headers.Cookie)}); throw error; }
} });
let result, config;
try {
  config = await loadAutoLoginConfig(process.cwd());
  if (!config) throw new Error('Preencha a senha e habilite TENDA_AUTO_LOGIN no .env.local. Nenhuma tentativa foi feita.');
  const connection = await client.connect(config.host,config.password); config.password = '';
  const overview = await client.overview(), clients = await client.clients(), mesh = await client.mesh();
  result = { success: true, model: connection.model, firmware: connection.firmware, nodes: mesh.length, clients: clients.filter(c=>c.online).length, internet: overview.internet, steps };
} catch (error) { result = { success:false,code:typeof error.code==='string'?error.code:'CONFIGURATION',message:typeof error.message==='string'?error.message:'O diagnóstico falhou.',steps }; process.exitCode=1; }
finally { if(config)config.password=''; await client.disconnect(); }
fs.writeFileSync('artifacts/login-diagnostics.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));

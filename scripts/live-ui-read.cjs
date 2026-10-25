// Explicit, read-only live integration check. Never included in the executable.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
if(!process.argv.includes('--read-only-live'))throw Error('Explicit --read-only-live is required');
const profile=path.resolve('artifacts/profiles/live-ui');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
BrowserWindow.prototype.show=function(){};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let done=false;
app.on('browser-window-created',(_event,win)=>{win.webContents.once('did-finish-load',async()=>{
  let result;
  try{
    const deadline=Date.now()+25000;let ready=false;
    while(Date.now()<deadline){ready=await win.webContents.executeJavaScript("Boolean(document.querySelector('.app-shell'))");if(ready)break;await wait(100);}
    if(!ready)throw Error('A interface não concluiu o login automático.');
    const state=await win.webContents.executeJavaScript('window.tenda.connection()');if(!state.ok||!state.data.connected||state.data.demo)throw Error('O login real não foi estabelecido.');
    const summary=await win.webContents.executeJavaScript('(async()=>{const overview=await window.tenda.overview(),clients=await window.tenda.clients(),mesh=await window.tenda.mesh();for(const [kind,value] of [["overview",overview],["clients",clients],["mesh",mesh]])if(!value.ok)throw Error(kind+": "+value.error.code+" "+value.error.message);return {nodes:mesh.data.length,clients:clients.data.filter(c=>c.online).length,internet:overview.data.internet}})()');
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Monitoramento').click()`);await wait(2300);
    const monitoring=await win.webContents.executeJavaScript(`(async()=>{const state=await window.tenda.monitoringStatus(),history=await window.tenda.monitoringHistory({period:'5m'});if(!state.ok||!history.ok)throw Error('Monitoring IPC failed');if(!state.data.storage.healthy)throw Error('SQLite worker failed');return {status:state.data.status,samples:history.data.summary.samples,points:history.data.points.length,countersAvailable:state.data.consumptionSupported,consumptionShown:history.data.summary.downloadBytes!==null,liveResourceReadings:state.data.resources.filter(r=>r.current).length,probeTargets:state.data.quality.length,probeHelperAvailable:state.data.probeAvailable}})()`);
    if(monitoring.samples<2||monitoring.points<2)throw Error('Live monitoring did not advance');
    result={success:true,automaticLogin:true,model:state.data.model,firmware:state.data.firmware,...summary,monitoring};await win.webContents.executeJavaScript('window.tenda.disconnect()');
  }catch(error){result={success:false,message:error.message};}
  finally{done=true;fs.writeFileSync('artifacts/live-ui-read.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(result.success?0:1);}
});});
setTimeout(()=>{if(!done){console.log('Live UI check did not complete.');app.exit(1);}},35000).unref();
require('../out/main.cjs');

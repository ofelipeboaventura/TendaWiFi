// Development-only harness. Excluded from packaged application files.
const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const output=path.resolve('artifacts');fs.mkdirSync(output,{recursive:true});
const packagedAsar=process.argv.includes('--packaged-asar');
const profile=path.join(output,packagedAsar?'smoke-asar-profile':'smoke-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:path.join(output,options.defaultPath)});
const findings={errors:[],checks:[]};
let historyCalls=0;const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>register(channel,async(...args)=>{if(channel==='tenda:monitoringHistory')historyCalls++;return handler(...args)});
BrowserWindow.prototype.show=function(){};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(80);}throw Error('Timed out waiting for application state');}
async function evaluate(win,code){return win.webContents.executeJavaScript(code,true);}
async function screenshot(win,name){win.webContents.beginFrameSubscription(()=>{});try{await evaluate(win,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');win.webContents.invalidate();await wait(100);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}finally{win.webContents.endFrameSubscription();}}
async function clickText(win,label,selector='button'){const result=await evaluate(win,`(()=>{const button=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(label)} || e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});if(!button)return false;button.click();return true})()`);if(!result)throw Error('Control not found: '+label);}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',event=>{if(event.level==='error')findings.errors.push(String(event.message).slice(0,500));});
  win.webContents.once('did-finish-load',async()=>{
    try{
      await until(()=>evaluate(win,`Boolean(document.querySelector('.login-shell')) || document.body.innerText.includes('demonstração')`));
      await wait(150);await screenshot(win,'login');
      const safety=await evaluate(win,`({require:typeof window.require,node:typeof window.process,bridge:!!window.tenda,rawIPC:!!window.tenda?.invoke})`);
      if(safety.require!=='undefined'||safety.node!=='undefined'||!safety.bridge||safety.rawIPC)throw Error('Renderer isolation failed');findings.checks.push('renderer isolation');
      const loginText=await evaluate(win,'document.body.innerText');
      const label=await evaluate(win,`Array.from(document.querySelectorAll('button')).find(e=>/demonstração/i.test(e.textContent))?.textContent.trim()`);
      if(!label)throw Error('Demo button missing: '+loginText.slice(0,300));await clickText(win,label);
      await until(()=>evaluate(win,`Boolean(document.querySelector('.app-shell')) && document.querySelector('.metric-card') !== null`));
      await wait(250);await screenshot(win,'overview');findings.checks.push('demo overview and polling');
      await clickText(win,'Monitoramento','.nav-item');await wait(2200);
      await until(()=>evaluate(win,`document.querySelector('.monitor-series-layer[data-painted]') !== null`));
      await screenshot(win,'monitor-overview');
      const initialHistoryCalls=historyCalls;await wait(1500);if(historyCalls!==initialHistoryCalls)throw Error('Per-second history polling still active');findings.checks.push('incremental chart stream without history polling');
      win.webContents.beginFrameSubscription(()=>{});await evaluate(win,"window.chartStrokes=0;window.originalStroke=CanvasRenderingContext2D.prototype.stroke;CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.classList.contains('monitor-series-layer'))window.chartStrokes++;return window.originalStroke.apply(this,args)};true");
      await wait(150);const moving=await evaluate(win,'window.chartStrokes');if(moving<2)throw Error('Chart animation not moving');
      win.webContents.setBackgroundThrottling(true);win.hide();await wait(200);findings.hiddenDocument=await evaluate(win,'document.hidden');const frozen=await evaluate(win,'window.chartStrokes');await wait(300);if(await evaluate(win,'document.hidden')&&await evaluate(win,'window.chartStrokes')!==frozen)throw Error('Hidden chart still drawing');win.webContents.setBackgroundThrottling(false);await wait(150);win.webContents.endFrameSubscription();findings.checks.push('canvas animation and hidden-window pause');

      const monitor=await evaluate(win,'window.tenda.monitoringStatus()');if(!monitor.ok||!monitor.data.storage.healthy||monitor.data.clients.length<5)throw Error('Monitor collector or SQLite worker failed');
      const history=await evaluate(win,`window.tenda.monitoringHistory({period:'5m'})`);if(!history.ok||history.data.points.length<2||BigInt(history.data.summary.downloadBytes??'0')<=0n)throw Error('Monitor history or real-counter delta failed');
      const unauthorized=await evaluate(win,`window.tenda.monitoringSaveSettings({downloadMbps:100,uploadMbps:20,alerts:true,muted:false,latencyMs:100,lossPercent:5,cpuPercent:80,memoryPercent:90,saturationPercent:90,host:'8.8.8.8'})`);if(unauthorized.ok||unauthorized.error.code!=='VALIDATION')throw Error('Monitoring IPC whitelist failed');
      findings.checks.push('monitoring collector, SQLite history, counter deltas and IPC validation');
      for(const kind of ['traffic','devices','quality','events']){const exported=await evaluate(win,`window.tenda.exportMonitoring({period:'5m',kind:${JSON.stringify(kind)}})`);if(!exported.ok||!exported.data.saved||!fs.existsSync(path.join(output,`TendaWiFi-${kind}-5m.csv`)))throw Error('CSV export failed: '+kind);}findings.checks.push('all four CSV export types');
      const changed=await evaluate(win,`(async()=>{const current=await window.tenda.monitoringStatus();return window.tenda.monitoringSaveSettings({...current.data.settings,downloadMbps:500,uploadMbps:100,muted:true})})()`);if(!changed.ok||changed.data.downloadMbps!==500)throw Error('Monitoring settings save failed');
      await evaluate(win,`document.querySelector('[aria-label="Configurar monitoramento"]').click()`);await until(()=>evaluate(win,`!!document.querySelector('.monitor-settings')`));await screenshot(win,'monitor-settings');await clickText(win,'Cancelar');findings.checks.push('monitoring preferences');
      for(const label of ['Dispositivos','Qualidade','Recursos','Eventos']){await clickText(win,label,'.monitor-tabs button');await wait(200);await screenshot(win,'monitor-'+{'Dispositivos':'devices','Qualidade':'quality','Recursos':'resources','Eventos':'events'}[label]);}
      const beforeClose=(await evaluate(win,'window.tenda.monitoringStatus()')).data.sampledAt;win.close();if(win.isDestroyed())throw Error('Close-to-tray failed');await wait(1200);const afterClose=(await evaluate(win,'window.tenda.monitoringStatus()')).data.sampledAt;if(afterClose<=beforeClose)throw Error('Background collection stopped');findings.checks.push('close to tray continues collection');
      await evaluate(win,'window.tenda.monitoringPause({paused:true})');const pausedAt=(await evaluate(win,'window.tenda.monitoringStatus()')).data.sampledAt;await wait(1200);if((await evaluate(win,'window.tenda.monitoringStatus()')).data.sampledAt!==pausedAt)throw Error('Paused collector made a new sample');await evaluate(win,'window.tenda.monitoringPause({paused:false})');findings.checks.push('monitor pause and resume');
      const features=await evaluate(win,'window.tenda.features()');if(!features.ok||features.data.length<28)throw Error('Feature catalog missing');
      for(const feature of features.data.filter(f=>f.available!==false)){
        const result=await evaluate(win,`window.tenda.readFeature({id:${JSON.stringify(feature.id)}})`);
        if(!result.ok)throw Error('Feature read failed: '+feature.id+' '+result.error.message);
      }findings.checks.push('all available feature snapshots');
      for(const page of ['Rede Mesh','Dispositivos','Wi-Fi','Internet e rede','Segurança','Sistema','Manutenção','Registros']){
        await clickText(win,page,'.nav-item');await wait(180);
        if(page==='Wi-Fi')await wait(100);
        const text=await evaluate(win,'document.body.innerText');if(!text.includes(page))throw Error('Page did not open: '+page);
        const name={'Rede Mesh':'mesh','Dispositivos':'clients','Wi-Fi':'wifi','Internet e rede':'network','Segurança':'security','Sistema':'system','Manutenção':'maintenance','Registros':'logs'}[page];await screenshot(win,name);
        findings.checks.push('page '+page);
      }
      await clickText(win,'Manutenção','.nav-item');await wait(100);await clickText(win,'Reiniciar');
      await until(()=>evaluate(win,`Boolean(document.querySelector('[role="dialog"]'))`));
      await screenshot(win,'confirmation');
      if(!await evaluate(win,`document.querySelector('[role="dialog"]').innerText.includes('Reiniciar')`))throw Error('Review details missing');
      await clickText(win,'Cancelar');findings.checks.push('maintenance review and cancel');
      const rejected=await evaluate(win,`window.tenda.prepareAction({action:'reboot',nodeId:'NOT-OWNED'})`);if(rejected.ok||rejected.error.code!=='FORBIDDEN')throw Error('Ownership validation failed');
      const schema=await evaluate(win,`window.tenda.connect({host:'192.168.0.1',password:'do-not-send',extra:true})`);if(schema.ok||schema.error.code!=='VALIDATION')throw Error('IPC whitelist failed');findings.checks.push('IPC schema and ownership');
      await clickText(win,'Encerrar sessão');await until(()=>evaluate(win,`!document.querySelector('.app-shell')`));findings.checks.push('logout');
      findings.success=true;
    }catch(error){findings.success=false;findings.failure=error.message;}
    finally{fs.writeFileSync(path.join(output,'smoke.json'),JSON.stringify(findings,null,2));console.log(JSON.stringify(findings,null,2));app.exit(findings.success?0:1);}
  });
});
setTimeout(()=>{findings.success=false;findings.failure='Smoke deadline exceeded';fs.writeFileSync(path.join(output,'smoke.json'),JSON.stringify(findings,null,2));app.exit(1);},60000).unref();
require(packagedAsar?path.resolve('release/'+require('../package.json').version+'/win-unpacked/resources/app.asar/out/main.cjs'):'../out/main.cjs');

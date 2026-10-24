// Development-only harness. Excluded from packaged application files.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const output=path.resolve('artifacts');fs.mkdirSync(output,{recursive:true});
const findings={errors:[],checks:[]};
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
require('../out/main.cjs');

// Isolated synthetic fixture: no router, auto-login, IPC backend or production history.
const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path');
const directory=path.resolve('artifacts/wifi-mesh');app.setPath('userData',path.join(directory,'profile'));
const findings={checks:[],layouts:[],errors:[]};const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error')findings.errors.push(String(event.message).slice(0,300));});
 const read=code=>win.webContents.executeJavaScript(code,true);
 const until=async fn=>{const end=Date.now()+8000;while(Date.now()<end){if(await fn())return;await wait(40);}throw Error('Fixture state timeout');};
 const assert=async(code,message)=>{if(!await read(code))throw Error(message);};
 const screenshot=async(name)=>{win.webContents.invalidate();await read('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(80);fs.writeFileSync(path.join(directory,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 try{
  await win.loadFile(path.join(directory,'fixture.html'));win.webContents.beginFrameSubscription(()=>{});
  win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  await until(()=>read("document.querySelectorAll('.wm-node-row').length===4"));
  await assert("document.querySelector('.wm-history').innerText.includes('Carregando')&&!document.querySelector('.wm-history').innerText.includes('Nenhuma mudança')",'Pending history is presented as empty');
  await read('window.wifiMeshTest.resolve()');await until(()=>read("document.querySelector('.wm-history').innerText.includes('Nenhuma mudança')"));
  await assert("document.querySelectorAll('.wm-radio').length===3&&document.querySelectorAll('.wm-radio')[2].innerText.includes('Desatualizado')",'Radio states missing');
  await assert("document.querySelector('.wm-node-row').innerText.includes('Não se aplica')&&document.querySelector('.wm-exclusions').innerText.includes('1 em roaming')",'Controller quality or ambiguity is misleading');
  findings.checks.push('loading, empty history, stale radios, controller quality and excluded clients');
  await assert("document.querySelectorAll('.wm-node-details').length===0",'Details initially expanded');
  await read("document.querySelector('.wm-expand').focus()");win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await until(()=>read("document.querySelectorAll('.wm-node-details').length===1"));
  await assert("document.querySelector('.wm-expand').getAttribute('aria-expanded')==='true'&&document.activeElement.classList.contains('wm-expand')",'Keyboard expansion/focus failed');
  await assert("document.querySelectorAll('.wm-client-table tbody tr').length===20&&!window.fixtureXss&&document.querySelectorAll('.wm-clients img').length===0",'Pagination or escaping failed');
  await assert("[...document.querySelectorAll('.wm-client-table tbody tr')].some(r=>r.lastElementChild.textContent==='0')&&document.querySelector('.wm-detail-grid').innerText.includes('0 ms')",'Zero readings discarded');
  await read("document.querySelector('.wm-name[title^=\"<img\"]').focus()");
  findings.longNameFocus=await read("({active:document.activeElement.className,whiteSpace:getComputedStyle(document.activeElement).whiteSpace,matches:document.activeElement.matches(':focus'),text:document.activeElement.textContent})");
  await assert("getComputedStyle(document.activeElement).whiteSpace==='normal'",'Focused long names remain truncated');
  await read("document.querySelector('.wm-pagination button:last-child').click()");await until(()=>read("document.querySelectorAll('.wm-client-table tbody tr').length===5"));
  await read("(()=>{const input=document.querySelector('.wm-search input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'192.168.0.11');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until(()=>read("document.querySelectorAll('.wm-client-table tbody tr').length===1"));
  await assert("document.querySelector('.wm-client-table').innerText.includes('192.168.0.11')",'Search does not match IP');
  const beforeCalls=await read('window.wifiMeshTest.calls()');
  const widths=await read("[...document.querySelector('.wm-node-table>thead tr').children].map(e=>e.getBoundingClientRect().width)");
  await read('window.wifiMeshTest.update();window.wifiMeshTest.update();window.wifiMeshTest.update()');
  await assert("document.querySelector('.wm-expand').getAttribute('aria-expanded')==='true'&&document.querySelector('.wm-search input').value==='192.168.0.11'",'Update reset expansion or search');
  const afterWidths=await read("[...document.querySelector('.wm-node-table>thead tr').children].map(e=>e.getBoundingClientRect().width)");
  if(widths.some((v,i)=>Math.abs(v-afterWidths[i])>.1)||await read('window.wifiMeshTest.calls()')!==beforeCalls)throw Error('Live updates shift columns or perform extra queries');
  await read("(()=>{const input=document.querySelector('.wm-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until(()=>read("document.querySelectorAll('.wm-client-table tbody tr').length===20"));
  await read("(()=>{const input=document.querySelector('[aria-label=\"Filtrar conexão neste nó\"]');input.value='Ethernet';input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until(()=>read("document.querySelectorAll('.wm-client-table tbody tr').length===9"));
  findings.checks.push('keyboard expansion, focus, escaping, zero RSSI/ping, pagination, search and connection filter');
  findings.checks.push('stable column widths, local filters and selection across live updates');
  await read("document.querySelectorAll('.wm-expand')[1].click()");await assert("document.querySelectorAll('.wm-node-details').length===1&&document.querySelector('.wm-node-details').innerText.includes('Nenhum dispositivo')",'Opening another node did not replace details');
  await read("document.querySelector('.wm-expand').click()");
  await until(()=>read("!!document.querySelector('.wm-client-table')"));
  for(const width of [980,1280,1440,1920])for(const scale of [1,1.25,1.5]){
   win.setContentSize(width,1000);win.webContents.setZoomFactor(scale);await wait(80);
   const layout=await read("(()=>{const root=document.documentElement,table=document.querySelector('.wm-node-table'),scroll=table.parentElement;return{viewport:innerWidth,pageWidth:root.scrollWidth,pageClient:root.clientWidth,tableWidth:table.getBoundingClientRect().width,tableViewport:scroll.getBoundingClientRect().width,summaryColumns:getComputedStyle(document.querySelector('.wm-summary')).gridTemplateColumns,radioColumns:getComputedStyle(document.querySelector('.wm-radios')).gridTemplateColumns}})()");
   findings.layouts.push({width,scale,...layout});if(layout.pageWidth>layout.pageClient+1){findings.overflow=await read("[...document.querySelectorAll('body *')].filter(e=>!e.closest('.wm-table-scroll')&&e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,20).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,overflow:getComputedStyle(e).overflowX}))");throw Error('Page overflow at '+width+' / '+scale);}
   await read("document.querySelector('.wifi-mesh-page').scrollIntoView({block:'start'})");await screenshot('overview-'+width+'-'+scale);
   if(scale===1&&[980,1440,1920].includes(width)){await read("document.querySelector('.wm-nodes').scrollIntoView({block:'start'})");await screenshot('details-'+width);}
  }
  findings.checks.push('four viewport widths at 100%, 125% and 150%, with table-only overflow');
  win.webContents.setZoomFactor(1);win.setContentSize(1440,1000);await read('window.wifiMeshTest.offline()');await assert("document.querySelector('.wm-node-details').innerText.includes('Nenhum dispositivo')&&document.querySelector('.wm-expand').getAttribute('aria-expanded')==='true'",'Offline update discarded selected node');
  await read("window.wifiMeshTest.reset('error')");await until(()=>read("!!document.querySelector('.wm-history-error')"));await assert("!document.querySelector('.wm-history').innerText.includes('Nenhuma mudança')",'Error presented as zero history');
  await read('window.wifiMeshTest.empty()');await assert("document.querySelector('.wm-nodes').innerText.includes('Nenhum roteador')&&document.querySelector('.wm-summary').innerText.includes('Aguardando')",'Missing topology is represented as observed zero');
  findings.checks.push('offline nodes, missing topology and history failure without invented zero data');
  findings.success=findings.errors.length===0;
 }catch(error){findings.success=false;findings.failure=error.message;}
 finally{fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(findings,null,2));console.log(JSON.stringify(findings,null,2));app.exit(findings.success?0:1);}
});
setTimeout(()=>{console.error('Wi-Fi/Mesh fixture deadline exceeded');app.exit(1);},60000).unref();

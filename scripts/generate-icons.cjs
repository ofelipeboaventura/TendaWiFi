// Render our local vector at Windows icon sizes. This development tool is never packaged.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',path.resolve('artifacts/icon-profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:512,height:512,frame:false,transparent:true,backgroundColor:'#00000000',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const svg=fs.readFileSync(path.resolve('resources/icon.svg'),'utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%;display:block}</style>'+svg));
  const frames=[];
  for(const size of [16,20,24,32,40,48,64,128,256,512]){
    win.setContentSize(size,size);await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const png=(await win.webContents.capturePage()).toPNG();
    if(size===256)fs.writeFileSync('resources/icon.png',png);
    if(size===32)fs.writeFileSync('resources/tray.png',png);
    if(size===512)fs.writeFileSync('resources/icon-preview.png',png);
    if(size<=256)frames.push({size,png});
  }
  const head=Buffer.alloc(6+frames.length*16);head.writeUInt16LE(1,2);head.writeUInt16LE(frames.length,4);let offset=head.length;
  frames.forEach(({size,png},index)=>{const at=6+index*16;head[at]=head[at+1]=size===256?0:size;head.writeUInt16LE(1,at+4);head.writeUInt16LE(32,at+6);head.writeUInt32LE(png.length,at+8);head.writeUInt32LE(offset,at+12);offset+=png.length;});
  fs.writeFileSync('resources/icon.ico',Buffer.concat([head,...frames.map(frame=>frame.png)]));
  console.log(JSON.stringify({success:true,sizes:frames.map(f=>f.size)}));win.destroy();app.exit(0);
}).catch(()=>{console.error('Icon rendering failed.');app.exit(1);});

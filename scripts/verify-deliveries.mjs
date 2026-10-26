// Verify the current delivery without starting it or contacting the router.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getCurrentFuseWire} from '@electron/fuses';
const require=createRequire(import.meta.url),asar=require('@electron/asar'),{NtExecutable,NtExecutableResource,Resource,Data}=require('resedit');
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const hash=async file=>{const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,report=JSON.parse(fs.readFileSync('docs/release.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version)||report.version!==version)throw Error('Version mismatch.');
const asset='TendaWiFi-'+version+'-win-x64.exe',directory=path.resolve('release',version,'win-unpacked'),portable=path.resolve('release',version,'publish',asset);
for(const file of [report.file,portable,path.resolve('release',version,asset)])if(await hash(file)!==report.sha256)throw Error('Delivery checksum mismatch.');
const archive=path.join(directory,'resources','app.asar'),entries=asar.listPackage(archive).map(e=>e.replace(/^[/\\]+/,'').replaceAll('\\','/'));
for(const entry of entries)if(!/^(?:out|dist|dist\/assets|resources|resources\/(?:icon|tray)\.png|out\/[^/]+\.cjs|dist\/(?:index\.html|assets\/[^/]+)|package\.json)$/.test(entry))throw Error('Unexpected archive entry: '+entry);
if(JSON.parse(asar.extractFile(archive,'package.json')).version!==version)throw Error('Archive version mismatch.');
for(const entry of entries.filter(e=>e.startsWith('out/')||e.startsWith('dist/')||e.startsWith('resources/'))){const local=path.resolve(entry);if(fs.statSync(local).isFile()&&digest(asar.extractFile(archive,entry.replaceAll('/',path.sep)))!==digest(fs.readFileSync(local)))throw Error('Build mismatch: '+entry);}
const main=asar.extractFile(archive,'out/main.cjs').toString(),startup=main.match(/desktopSetStartup:\s*\(\w+\)\s*=>\s*\{[\s\S]{0,850}/)?.[0];
if(!startup?.includes('connection().connected')||!startup.includes('"AUTH"'))throw Error('Startup authorization missing.');
const fuse=await getCurrentFuseWire(path.join(directory,'Tenda WiFi Desktop.exe'));
for(const[index,state]of Object.entries({0:48,1:49,2:48,3:48,4:49,5:49,7:48}))if(fuse[index]!==state)throw Error('Unexpected fuse '+index);
const expectedIcons=Data.IconFile.from(fs.readFileSync('resources/icon.ico')).icons.map(i=>digest(Buffer.from(i.data.bin)));
const native=[];
for(const file of [portable,path.join(directory,'Tenda WiFi Desktop.exe')]){
 const pe=NtExecutable.from(fs.readFileSync(file)),res=NtExecutableResource.from(pe),groups=Resource.IconGroupEntry.fromEntries(res.entries);
 const icons=groups.flatMap(g=>g.getIconItemsFromEntries(res.entries)).filter(i=>i.isRaw()).map(i=>digest(Buffer.from(i.bin)));
 if(!expectedIcons.every(h=>icons.includes(h)))throw Error('Embedded icon mismatch: '+path.basename(file));
 const vi=Resource.VersionInfo.fromEntries(res.entries)[0],values=vi.getStringValues(vi.getAllLanguagesForStringValues()[0]);
 if(values.FileVersion.split('.').slice(0,3).join('.')!==version)throw Error('PE version mismatch.');
 const manifest=Buffer.from(res.entries.find(e=>e.type===24)?.bin??[]).toString('utf8');
 if(!manifest.includes('level="asInvoker"'))throw Error('Unexpected privilege level.');
 native.push({file:path.basename(file),version:values.FileVersion,product:values.ProductName,iconSizes:expectedIcons.length,executionLevel:'asInvoker'});
}
const desktop=JSON.parse(fs.readFileSync('artifacts/smoke-'+version+'-asar.json','utf8'));if(!desktop.success||desktop.errors.length)throw Error('Desktop verification failed.');
if(await hash('US_RX27_PROV1.0br_V16.03.28.20_multi_9569_TDE01.bin')!=='0121bd96ee3f590f9f4a21a2b60220028f7f94f460f6579382dd15e22737dd62')throw Error('Original firmware changed.');
const result={success:true,version,sha256:report.sha256,desktopChecks:desktop.checks.length,archiveEntries:entries.length,native,fusesVerified:true,firmwarePreserved:true};
fs.mkdirSync('artifacts/releases',{recursive:true});fs.writeFileSync('artifacts/releases/v'+version+'-package.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

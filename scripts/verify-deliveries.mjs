// Verify the three local delivery artifacts without starting them or contacting the router.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getCurrentFuseWire} from '@electron/fuses';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const fileDigest=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const expected={
  '0.3.0':'e3af9edda96f04fb04850a2e63e21454c30c0b387b1a24037931e6beee5ba3aa',
  '0.4.0':'3d610d53c2bf1bf1be51c8f04065743cb1a144403a6692a28990cdf404edc796',
  '0.5.0':'9e895e68d0f29407ba4d5db04c1a62bea8db29db9ddff4df391d3308903f5702',
};
const releases=[];
for(const [version,sha256] of Object.entries(expected)){
  const file=`TendaWiFi-${version}.exe`,directory=path.resolve('release',version,'win-unpacked');
  if(await fileDigest(file)!==sha256)throw Error(`Delivery checksum mismatch: ${version}`);
  if(await fileDigest(path.join('release',version,`TendaWiFi-${version}-win-x64.exe`))!==sha256)throw Error(`Builder checksum mismatch: ${version}`);
  const archive=path.join(directory,'resources','app.asar'),entries=asar.listPackage(archive).map(entry=>entry.replace(/^[/\\]+/,'').replaceAll('\\','/'));
  for(const entry of entries)if(!/^(?:out|dist|dist\/assets|out\/[^/]+\.cjs|dist\/(?:index\.html|assets\/[^/]+)|package\.json)$/.test(entry))throw Error(`Unexpected archive entry: ${entry}`);
  if(JSON.parse(asar.extractFile(archive,'package.json')).version!==version)throw Error(`Archive identity mismatch: ${version}`);
  const main=asar.extractFile(archive,'out/main.cjs'),startup=main.toString().match(/desktopSetStartup:\s*\(\w+\)\s*=>\s*\{[\s\S]{0,850}/)?.[0];
  if(!startup||!startup.includes('connection().connected')||!startup.includes('"AUTH"'))throw Error(`Startup authorization missing: ${version}`);
  if(version==='0.5.0')for(const entry of entries.filter(entry=>/^(?:out\/.*\.cjs|dist\/)/.test(entry)&&!['dist/assets'].includes(entry))){
    const local=path.resolve(entry);if(!fs.statSync(local).isFile())continue;
    if(digest(asar.extractFile(archive,entry.replaceAll('/',path.sep)))!==digest(fs.readFileSync(local)))throw Error(`Final build mismatch: ${entry}`);
  }
  const fuse=await getCurrentFuseWire(path.join(directory,'Tenda WiFi Desktop.exe'));
  for(const [index,state] of Object.entries({0:48,1:49,2:48,3:48,4:49,5:49,7:48}))if(fuse[index]!==state)throw Error(`Unexpected fuse ${index}: ${version}`);
  const desktop=JSON.parse(fs.readFileSync(`artifacts/smoke-${version}-asar.json`,'utf8'));if(!desktop.success||desktop.errors.length)throw Error(`Desktop verification failed: ${version}`);
  releases.push({version,file,bytes:fs.statSync(file).size,sha256,signed:false,desktopChecks:desktop.checks.length,archiveEntries:entries.length,fusesVerified:true});
}
const firmware='US_RX27_PROV1.0br_V16.03.28.20_multi_9569_TDE01.bin';
if(await fileDigest(firmware)!=='0121bd96ee3f590f9f4a21a2b60220028f7f94f460f6579382dd15e22737dd62')throw Error('Original firmware checksum mismatch.');
fs.writeFileSync('SHA256SUMS.txt',releases.map(r=>`${r.sha256}  ${r.file}`).join('\n')+'\n');
fs.writeFileSync('docs/releases.json',JSON.stringify({latest:'0.5.0',platform:'win32-x64',releases},null,2)+'\n');
console.log(JSON.stringify({success:true,releases,firmwarePreserved:true},null,2));

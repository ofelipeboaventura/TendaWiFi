// Rebuild this task's earlier release snapshots with the final startup authorization guard.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire}from'node:module';
const require=createRequire(import.meta.url),asar=require('@electron/asar'),builder=require('electron-builder');
const version=process.argv[2];if(!['0.3.0','0.4.0'].includes(version))throw Error('Expected one of this task’s previous release versions.');
const root=process.cwd(),source=path.resolve('release',version,'win-unpacked/resources/app.asar'),directory=path.resolve('artifacts/release-rebuild',version);
const meta=JSON.parse(asar.extractFile(source,'package.json'));if(meta.version!==version)throw Error('Snapshot identity mismatch.');
for(const entry of asar.listPackage(source)){const name=entry.replace(/^[/\\]+/,'').replaceAll('\\','/');if(!/^(?:out|dist|dist\/assets|out\/[^/]+\.cjs|dist\/(?:index\.html|assets\/[^/]+)|package\.json)$/.test(name))throw Error('Unexpected archive entry.');}
fs.mkdirSync(directory,{recursive:true});asar.extractAll(source,directory);
const file=path.join(directory,'out/main.cjs');let main=fs.readFileSync(file,'utf8');const marker=/desktopSetStartup:\s*\(\w+\)\s*=>\s*\{/g,matches=[...main.matchAll(marker)];if(matches.length!==1)throw Error('Startup handler not uniquely identified.');
const offset=matches[0].index+matches[0][0].length,errorClass=main.slice(offset,offset+500).match(/new (\w+)\("UNSUPPORTED"/)?.[1];if(!errorClass)throw Error('Expected trusted application error handler.');
if(!main.slice(offset,offset+400).includes('!service.connection().connected'))main=main.slice(0,offset)+`\n      if (!service.connection().connected) throw new ${errorClass}("AUTH", "Conecte-se ao roteador antes de alterar a inicializacao.");`+main.slice(offset);
fs.writeFileSync(file,main);meta.dependencies={};meta.devDependencies={};fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(meta,null,2));
const config=JSON.parse(fs.readFileSync('package.json','utf8')).build;
await builder.build({targets:builder.Platform.WINDOWS.createTarget(['portable'],builder.Arch.x64),config:{...config,directories:{...config.directories,app:directory,output:path.resolve('release',version)},electronVersion:require('electron/package.json').version,electronDist:path.resolve('node_modules/electron/dist')}});
console.log(JSON.stringify({version,rebuilt:true,guard:'AUTH before startup writes'}));

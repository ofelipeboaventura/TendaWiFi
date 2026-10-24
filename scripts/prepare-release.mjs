import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const source=path.resolve(process.argv[2]??`release/TendaWiFi-${pkg.version}-win-x64.exe`);
const releaseRoot=await fs.realpath('release');
if(!source.startsWith(releaseRoot+path.sep))throw Error('O executável deve estar na pasta release deste projeto.');
const header=await fs.open(source,'r');try{const bytes=Buffer.alloc(2);await header.read(bytes,0,2,0);if(bytes.toString()!=='MZ')throw Error('O arquivo não é um executável Windows.');}finally{await header.close();}
const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);const digest=hash.digest('hex');
const targetName=process.argv[3]??'TendaWiFi.exe';
if(!/^TendaWiFi(?:-\d+\.\d+\.\d+)?\.exe$/.test(targetName))throw Error('Nome de executável de entrega inválido.');
const target=path.resolve(targetName);
try{await fs.copyFile(source,target,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;const existing=createHash('sha256');for await(const chunk of createReadStream(target))existing.update(chunk);if(existing.digest('hex')!==digest)throw Error('TendaWiFi.exe já existe com outro conteúdo; ele foi preservado.');}
await fs.writeFile(path.join(path.dirname(source),'SHA256SUMS.txt'),`${digest}  ${path.basename(source)}\n`);
await fs.writeFile('SHA256SUMS.txt',`${digest}  ${targetName}\n`);
const report={version:pkg.version,file:targetName,bytes:(await fs.stat(target)).size,sha256:digest,signed:false};
await fs.writeFile('docs/release.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

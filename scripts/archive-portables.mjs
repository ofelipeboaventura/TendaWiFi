// Move only previous portable launchers; never inspect or move the private .env.local.
import fs from'node:fs/promises';
import path from'node:path';
import{createReadStream}from'node:fs';
import{createHash}from'node:crypto';
if(process.argv[2]!=='--apply')throw Error('Use --apply para arquivar portáteis anteriores.');
const root=await fs.realpath('.'),current=JSON.parse(await fs.readFile('package.json','utf8')).version;
const hash=async file=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
const moved=[];
for(const name of await fs.readdir(root)){
  const match=name.match(/^TendaWiFi(?:-(\d+\.\d+\.\d+))?\.exe$/);if(!match||match[1]===current)continue;
  const source=path.join(root,name);if(!(await fs.lstat(source)).isFile())throw Error('Origem inválida.');
  const directory=path.join(root,'release','archive',match[1]??'legacy');await fs.mkdir(directory,{recursive:true});
  if(!(await fs.realpath(directory)).startsWith(root+path.sep))throw Error('Destino fora do projeto.');
  const destination=path.join(directory,name),sha256=await hash(source);
  try{await fs.lstat(destination);throw Error('Destino já existe; arquivos preservados.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.rename(source,destination);if(await hash(destination)!==sha256)throw Error('Checksum após arquivamento não confere.');
  moved.push({file:name,destination:path.relative(root,destination).replaceAll('\\','/'),sha256});
}
const manifest=JSON.parse(await fs.readFile('docs/releases.json','utf8'));
for(const release of manifest.releases){const archived=moved.find(item=>item.file===release.file);if(archived)release.file=archived.destination;}
await fs.writeFile('docs/releases.json',JSON.stringify(manifest,null,2)+'\n');
await fs.mkdir('artifacts/releases',{recursive:true});await fs.writeFile('artifacts/releases/archived.json',JSON.stringify(moved,null,2)+'\n');
console.log(JSON.stringify({archived:moved},null,2));

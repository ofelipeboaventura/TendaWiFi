import fs from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const pkg=JSON.parse(await fs.readFile('package.json','utf8')),version=pkg.version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Versão inválida.');
const asset=`TendaWiFi-${version}-win-x64.exe`,source=path.resolve('release',version,asset);
const releaseRoot=await fs.realpath('release'),resolved=await fs.realpath(source);
if(!resolved.startsWith(releaseRoot+path.sep))throw Error('Executável fora da distribuição local.');
const header=await fs.open(resolved,'r');try{const bytes=Buffer.alloc(2);await header.read(bytes,0,2,0);if(bytes.toString()!=='MZ')throw Error('Executável Windows inválido.');}finally{await header.close();}
const hashFile=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const sha256=await hashFile(resolved),file=`TendaWiFi-${version}.exe`,publish=path.resolve('release',version,'publish');
await fs.mkdir(publish,{recursive:true});
for(const destination of [path.resolve(file),path.join(publish,asset)]){
  try{await fs.copyFile(resolved,destination,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;if(await hashFile(destination)!==sha256)throw Error('Arquivo existente com conteúdo diferente foi preservado: '+path.basename(destination));}
}
await fs.writeFile(path.join(publish,'SHA256SUMS.txt'),`${sha256}  ${asset}\n`);
await fs.writeFile(path.join(publish,'COMO-USAR.txt'),`Tenda WiFi Desktop ${version} — Windows x64 portátil\r\n\r\n1. Encerre a versão anterior usando Sair na bandeja.\r\n2. Execute ${asset}; não requer instalação, Node nem administrador.\r\n3. Informe o endereço local do roteador e a senha de administração.\r\n4. Fechar a janela mantém a coleta. Sair na bandeja encerra o aplicativo.\r\n\r\nHistórico existente é preservado na pasta do usuário Windows. Não faça downgrade após atualizar o banco.\r\nConsumo sem contador confirmado é identificado como estimativa. Ausências não são preenchidas.\r\nProjeções e anomalias aguardam histórico com cobertura suficiente.\r\nInicialização com Windows é opcional e desativada por padrão.\r\nLogin automático opcional: crie .env.local ao lado deste executável conforme o README.\r\nNunca publique esse arquivo nem a senha. Nenhuma credencial acompanha o pacote.\r\n\r\nProjeto independente; executável sem assinatura de editor. Compare SHA-256 com SHA256SUMS.txt.\r\nReleases: https://github.com/ofelipeboaventura/TendaWiFi/releases\r\n`);
const report={version,file,asset,directory:path.relative(process.cwd(),publish).replaceAll('\\','/'),bytes:(await fs.stat(resolved)).size,sha256,signed:false};
await fs.writeFile(path.join(publish,'release.json'),JSON.stringify(report,null,2)+'\n');
await fs.writeFile('docs/release.json',JSON.stringify(report,null,2)+'\n');
await fs.writeFile('SHA256SUMS.txt',`${sha256}  ${file}\n`);
let previous={releases:[]};try{previous=JSON.parse(await fs.readFile('docs/releases.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const releases=previous.releases.filter(r=>r.version!==version);releases.push(report);
await fs.writeFile('docs/releases.json',JSON.stringify({latest:version,platform:'win32-x64',releases},null,2)+'\n');
console.log(JSON.stringify(report,null,2));

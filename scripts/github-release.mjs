import fs from'node:fs';
import path from'node:path';
import {createHash}from'node:crypto';
import {execFileSync}from'node:child_process';
import {githubClient,repository}from'./lib/github-api.mjs';
const mode=process.argv[2];if(!['--inspect','--draft','--publish','--verify'].includes(mode))throw Error('Use --inspect, --draft, --publish ou --verify.');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
if(git('remote','get-url','origin')!==`https://github.com/${repository}.git`)throw Error('Repositório remoto inesperado.');
const api=githubClient(),base=`/repos/${repository}`;
if(mode==='--inspect'){
  const releases=await api(base+'/releases?per_page=30');console.log(JSON.stringify(releases.map(r=>({id:r.id,tag:r.tag_name,draft:r.draft,url:r.html_url,assets:r.assets.map(a=>({name:a.name,size:a.size,digest:a.digest}))})),null,2));
}else{
  const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Versão inválida.');
  const tag='v'+version,head=git('rev-parse','HEAD'),report=JSON.parse(fs.readFileSync('docs/release.json','utf8'));
  if(git('status','--porcelain')||git('branch','--show-current')!=='main')throw Error('Publique somente o commit limpo da branch atual main.');
  if(report.version!==version||!/^([a-f0-9]{64})$/.test(report.sha256))throw Error('Manifesto incompatível.');
  const root=fs.realpathSync(path.join('release',version,'publish'));
  const names=[`TendaWiFi-${version}-win-x64.exe`,'SHA256SUMS.txt','COMO-USAR.txt','release.json'];
  if(JSON.stringify(fs.readdirSync(root).sort())!==JSON.stringify([...names].sort()))throw Error('Arquivos extras no diretório de publicação.');
  const assets=[];
  for(const name of names){const file=path.join(root,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>256*1024*1024||!fs.realpathSync(file).startsWith(root+path.sep))throw Error('Asset inválido.');const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);assets.push({name,file,size:stat.size,sha256:hash.digest('hex')});}
  if(assets[0].sha256!==report.sha256||assets[0].size!==report.bytes)throw Error('Executável diverge do manifesto.');
  if(fs.readFileSync(path.join(root,'SHA256SUMS.txt'),'utf8')!==`${report.sha256}  ${names[0]}\n`)throw Error('Checksum divergente.');
  if(JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8')).sha256!==report.sha256)throw Error('Manifesto do asset divergente.');
  const ref=await api(base+'/git/ref/heads/main');if(ref.object.sha!==head)throw Error('Commit atual não está publicado em main.');
  const tagged=await api(base+'/git/ref/tags/'+tag);let target=tagged.object;if(target.type==='tag')target=(await api(base+'/git/tags/'+target.sha)).object;if(target.type!=='commit'||target.sha!==head)throw Error('Tag não corresponde ao commit atual.');
  let release=await api(base+'/releases/tags/'+tag,{allow404:true});
  if(!release){const pending=(await api(base+'/releases?per_page=100')).filter(item=>item.tag_name===tag);if(pending.length>1)throw Error('Mais de uma release para a mesma tag.');release=pending[0];}
  if(!release){if(mode==='--verify')throw Error('Release inexistente.');release=await api(base+'/releases',{method:'POST',json:{tag_name:tag,target_commitish:head,name:`Tenda WiFi Desktop ${version}`,body:fs.readFileSync(`docs/releases/${tag}.md`,'utf8'),draft:true,prerelease:false}});console.log('Rascunho criado: '+release.html_url);}
  for(const asset of assets){
    let remote=release.assets.find(item=>item.name===asset.name);
    if(!remote){if(mode==='--verify'||!release.draft)throw Error('Asset ausente; release publicada não será alterada.');remote=await api(base+`/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,{method:'POST',upload:true,stream:fs.createReadStream(asset.file),size:asset.size,contentType:asset.name.endsWith('.exe')?'application/vnd.microsoft.portable-executable':asset.name.endsWith('.json')?'application/json':'text/plain; charset=utf-8'});console.log('Enviado: '+asset.name);}
    if(remote.size!==asset.size||remote.state!=='uploaded'||remote.digest!==`sha256:${asset.sha256}`)throw Error('Integridade do asset remoto não confere: '+asset.name);
  }
  release=await api(base+`/releases/${release.id}`);
  if(release.assets.length!==assets.length||release.assets.some(item=>!names.includes(item.name)))throw Error('Asset remoto inesperado.');
  for(const asset of assets){const remote=release.assets.find(item=>item.name===asset.name);if(!remote||remote.size!==asset.size||remote.digest!==`sha256:${asset.sha256}`||remote.state!=='uploaded')throw Error('Assets remotos incompletos.');}
  if(mode==='--publish'&&release.draft)release=await api(base+`/releases/${release.id}`,{method:'PATCH',json:{draft:false,make_latest:'true'}});
  const checked=await api(base+`/releases/${release.id}`);
  if(mode!=='--draft'&&checked.draft)throw Error('Release continua como rascunho.');
  const result={version,tag,commit:head,url:checked.html_url,draft:checked.draft,assets:checked.assets.map(a=>({name:a.name,bytes:a.size,sha256:a.digest,url:a.browser_download_url}))};
  fs.mkdirSync('artifacts/releases',{recursive:true});fs.writeFileSync(`artifacts/releases/${tag}-github.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}

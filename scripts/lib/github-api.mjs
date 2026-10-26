// Credentials remain in memory and go only to the two fixed GitHub API origins.
import {spawnSync}from'node:child_process';
export const repository='ofelipeboaventura/TendaWiFi';
export function githubClient(){
  const credential=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},timeout:15000});
  if(credential.status!==0)throw Error('Autenticação local do GitHub indisponível.');
  const token=credential.stdout.match(/^password=(.+)$/m)?.[1]?.trim();credential.stdout='';
  if(!token)throw Error('Credencial do GitHub indisponível.');
  return async function request(route,{method='GET',json,stream,size,contentType,upload=false,allow404=false}={}){
    if(!route.startsWith(`/repos/${repository}/`)||route.includes('..')||/[\r\n\\]/.test(route))throw Error('Rota GitHub não autorizada.');
    const url=new URL(route,upload?'https://uploads.github.com':'https://api.github.com');
    if(!['https://api.github.com','https://uploads.github.com'].includes(url.origin)||url.username||url.password)throw Error('Destino GitHub não autorizado.');
    const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'TendaWiFi-release-tool'};
    if(json!==undefined)headers['Content-Type']='application/json';
    if(stream){headers['Content-Type']=contentType;headers['Content-Length']=String(size);}
    const response=await fetch(url,{method,headers,body:stream??(json===undefined?undefined:JSON.stringify(json)),...(stream?{duplex:'half'}:{}),redirect:'error',signal:AbortSignal.timeout(stream?600000:30000)});
    if(allow404&&response.status===404)return null;
    if(!response.ok)throw Error(`GitHub ${method} falhou (HTTP ${response.status}).`);
    return response.status===204?null:response.json();
  };
}

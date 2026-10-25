import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApplyResult, ChangePreview, ConnectionStatus, ErrorCode, FeatureDefinition, FeatureSnapshot, JsonValue, Values } from '../../shared/types';
import { catalog, getPath, setPath, publicDefinition, type FeatureSpec, type FieldSpec, type TableSpec, ipv4, maskSchema, macAddress } from './catalog';
export { createDemoFeatureModules, getFeatureDefinitions } from './catalog';

export interface FeatureProvider {
  getConnection(): ConnectionStatus;
  readModules(modules:string[],params?:Record<string,string>):Promise<Record<string,unknown>>;
  writeModules(payload:Record<string,unknown>):Promise<Record<string,unknown>>;
}
export class FeatureError extends Error { constructor(public code:ErrorCode,message:string){super(message);this.name='FeatureError';} }
interface Pending { spec:FeatureSpec; payload:Record<string,unknown>; revision:string; expected:Values; changed:string[]; expires:number; connection:string }
function fail(message:string,code:ErrorCode='VALIDATION'):never{throw new FeatureError(code,message);}
const obj=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const rows=(x:unknown):Record<string,unknown>[]=>Array.isArray(x)?x.map(obj):[];
const stable=(v:unknown):string=>{if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v)??'null';};
const same=(a:unknown,b:unknown)=>stable(a)===stable(b);
const ipn=(s:string)=>s.split('.').reduce((n,v)=>(n*256+Number(v))>>>0,0);
const subnet=(address:string,network:string,mask:string)=>((ipn(address)&ipn(mask))>>>0)===((ipn(network)&ipn(mask))>>>0);
const unicast=(s:string,mask:string)=>{const host=(ipn(s)&~ipn(mask))>>>0;return host!==0&&host!==((~ipn(mask))>>>0)&&+s.split('.')[0]>0&&+s.split('.')[0]<224;};
const lines=(v:unknown)=>String(v??'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const daysToMask=(days:string)=>Array.from({length:7},(_,i)=>days.split(',').includes(String(i+1))?'1':'0').join('');
const maskToDays=(mask:unknown)=>typeof mask==='string'&&/^[01]{7}$/.test(mask)?[...mask].flatMap((x,i)=>x==='1'?[String(i+1)]:[]).join(','):String(mask??'');
const protect=(key:string)=>!['__proto__','constructor','prototype'].includes(key);

function normalizeScalar(raw:unknown,f:FieldSpec,maskSecrets:boolean):JsonValue {
  if(f.secret&&maskSecrets)return '';
  if(raw===undefined||raw===null)return structuredClone(f.fallback);
  if(f.type==='switch')return raw===true||raw===1||raw==='1'||raw==='true'||raw==='on'||raw==='enable';
  if(f.type==='number')return typeof raw==='number'?raw:Number.isFinite(Number(raw))?Number(raw):f.fallback;
  return typeof raw==='string'?raw:typeof raw==='number'?String(raw):f.fallback;
}
function projectTable(raw:unknown,t:TableSpec,maskSecrets:boolean):JsonValue[] {
  return rows(raw).filter(row=>row.operateType!=='system').map(row=>{
    const result:Values={};
    for(const f of t.fields){
      if(t.key==='parentControlList'){
        if(f.key==='deviceMacs'){result[f.key]=rows(row.deviceList).map(d=>String(d.mac??'')).join('\n');continue;}
        if(f.key==='allowedTimes'){result[f.key]=rows(row.allowDateList).map(d=>`${String(d.accessTime??'')} | ${maskToDays(d.accessDate)}`).join('\n');continue;}
        if(f.key==='urls'){result[f.key]=Array.isArray(row.urlList)?row.urlList.map(String).join('\n'):'';continue;}
      }
      if(t.key==='wifiWpsList'&&f.key==='start'){result[f.key]=false;continue;}
      result[f.key]=normalizeScalar(row[f.key],f,maskSecrets);
    }
    return result;
  });
}
function project(raw:Record<string,unknown>,spec:FeatureSpec,maskSecrets:boolean):Values {
  const result:Values={};
  for(const f of spec.fields){let value=getPath(raw,f.key);if(f.key==='wifiGuest.guestSecurityMode')value=typeof getPath(raw,'wifiGuest.guestPwd')==='string'&&String(getPath(raw,'wifiGuest.guestPwd')).length>0;if(f.key==='wifiTime.wifiTimeDate')value=maskToDays(value);if(f.key==='ipv6Cfg.wanIP'&&Array.isArray(value))value=value[0]??'';if(f.key==='ledCfg.closeTime'&&Array.isArray(value))value=value.join('-');result[f.key]=normalizeScalar(value,f,maskSecrets);}
  for(const t of spec.tables??[])result[t.key]=projectTable(getPath(raw,t.key),t,maskSecrets);
  return result;
}
// A keyed revision token avoids exposing a password-guessing oracle to the renderer.
const revisionKey=randomBytes(32);
const revision=(raw:Record<string,unknown>,spec:FeatureSpec)=>createHmac('sha256',revisionKey).update(stable(project(raw,spec,false))).digest('hex');
function schemaFor(spec:FeatureSpec):z.ZodType {
  const shape:Record<string,z.ZodType>={};
  for(const f of spec.fields)shape[f.key]=f.schema;
  for(const t of spec.tables??[]){const row:Record<string,z.ZodType>={};for(const f of t.fields)row[f.key]=f.schema;shape[t.key]=z.array(z.object(row).strict()).max(t.maxRows);}
  return z.object(shape).strict();
}
function knownModules(spec:FeatureSpec):string[]{return [...new Set([...spec.fields.map(f=>f.key.split('.')[0]),...(spec.tables??[]).map(t=>t.key.split('.')[0]),...(spec.related??[])])];}
function wireScalar(value:JsonValue,old:unknown):unknown {if(typeof old==='string'&&typeof value==='number')return String(value);if(typeof old==='string'&&typeof value==='boolean'&&['true','false'].includes(old))return String(value);if(typeof old==='string'&&typeof value==='boolean'&&['0','1'].includes(old))return value?'1':'0';return value;}
function duplicate(list:unknown[],label:string):void {const normalized=list.map(v=>String(v).toUpperCase());if(new Set(normalized).size!==normalized.length)fail(`${label}: há valores repetidos.`);}
function validateBusiness(spec:FeatureSpec,v:Values,raw:Record<string,unknown>):void {
  const get=(key:string)=>v[key];const s=(key:string)=>String(v[key]??'');const enabled=(key:string)=>v[key]===true;
  if(spec.id==='wifi'){
    if(enabled('wifiBasicCfg.doubleBand')&&enabled('wifiBasicCfg.tripleBand'))fail('Escolha uma única opção de unificação de bandas.');
    const names:string[]=[];
    for(const suffix of ['','_5g','_6g']){
      if(!Object.prototype.hasOwnProperty.call(v,'wifiBasicCfg.wifiEn'+suffix))continue;
      const base='wifiBasicCfg.';if(!enabled(base+'wifiEn'+suffix))continue;
      if(!s(base+'wifiSSID'+suffix).trim())fail('Informe o nome de todas as redes Wi-Fi ativas.');
      const mode=s(base+'wifiSecurityMode'+suffix),pwd=s(base+'wifiPwd'+suffix)||String(getPath(raw,base+'wifiPwd'+suffix)??'');
      if(!['none','wpa3saeowe'].includes(mode)&&(pwd.length<8||pwd.length>63||!/^[ -~]+$/.test(pwd)))fail('A senha Wi-Fi deve ter entre 8 e 63 caracteres ASCII imprimíveis.');
      names.push(s(base+'wifiSSID'+suffix));
    }
    const guest=obj(raw.wifiGuest);if(guest.guestEn&&['guestSSID','guestSSID_5g','guestSSID_6g'].some(k=>names.includes(String(guest[k]??''))))fail('A rede principal e a rede de visitantes devem ter nomes diferentes.');
  }
  if(spec.id==='wifi-advanced'){
    for(const suffix of ['','_5g','_6g']){
      if(!Object.prototype.hasOwnProperty.call(v,'wifiAdvCfg.wifiChannel'+suffix))continue;
      const selected=s('wifiAdvCfg.wifiChannel'+suffix);if(selected==='auto')continue;
      const source=getPath(raw,'wifiAdvCfg.wifiChannelList'+suffix);let list:unknown[]=[];
      if(Array.isArray(source))list=source;else {const map=obj(source),width=s('wifiAdvCfg.wifiBandwidth'+suffix);list=width==='auto'?Object.values(map).flatMap(x=>Array.isArray(x)?x:[]):Array.isArray(map[width])?map[width] as unknown[]:[];}
      if(!list.map(String).includes(selected))fail('O canal escolhido não é permitido para esta banda e largura no roteador.');
    }
  }
  if(spec.id==='guest'&&enabled('wifiGuest.guestEn')){
    const main=obj(raw.wifiBasicCfg),mainNames=['wifiSSID','wifiSSID_5g','wifiSSID_6g'].map(k=>String(main[k]??''));
    for(const name of ['guestSSID','guestSSID_5g','guestSSID_6g'].filter(name=>Object.prototype.hasOwnProperty.call(v,'wifiGuest.'+name)))if(!s('wifiGuest.'+name).trim()||s('wifiGuest.'+name).trim()!==s('wifiGuest.'+name)||mainNames.includes(s('wifiGuest.'+name)))fail('Informe nomes de visitantes diferentes dos nomes da rede principal e sem espaços nas extremidades.');
    const pwd=s('wifiGuest.guestPwd')||String(getPath(raw,'wifiGuest.guestPwd')??'');if(enabled('wifiGuest.guestSecurityMode')&&(pwd.length<8||pwd.length>63||!/^[ -~]+$/.test(pwd)||pwd!==pwd.trim()))fail('A senha de visitantes deve ter entre 8 e 63 caracteres ASCII e sem espaços nas extremidades.');
    duplicate(['guestSSID','guestSSID_5g','guestSSID_6g'].filter(key=>Object.hasOwn(v,'wifiGuest.'+key)).map(key=>s('wifiGuest.'+key)),'Nomes das redes de visitantes');
  }
  if(spec.id==='guest'&&!enabled('wifiGuest.guestEn')&&(enabled('wifiGuest.guestSecurityMode')!==Boolean(getPath(raw,'wifiGuest.guestPwd'))||s('wifiGuest.guestPwd')))fail('Ative a rede de visitantes ao alterar sua senha ou segurança.');
  if(spec.id==='wifi-schedule'&&enabled('wifiTime.wifiTimeEn')&&(!s('wifiTime.wifiTimeDate')||!s('wifiTime.wifiTimeClose')))fail('Informe o período e pelo menos um dia para a agenda.');
  if(spec.id==='led'&&s('ledCfg.ledType')==='manual'&&!s('ledCfg.closeTime'))fail('Informe o horário de desligamento dos LEDs.');
  if(spec.id==='wan'){
    const type=s('wanCfg.wanType');if(['pppoe','pppoe2'].includes(type)&&!s('wanCfg.wanPPPoEUser').trim())fail('Informe o usuário PPPoE.');
    if(type==='static'){
      for(const key of ['wanIP','wanMask','wanGateway'])if(!ipv4.safeParse(s('wanCfg.'+key)).success)fail('Informe IP, máscara e gateway estáticos válidos.');
      if(!maskSchema.safeParse(s('wanCfg.wanMask')).success)fail('Máscara WAN inválida.');
      if(!subnet(s('wanCfg.wanIP'),s('wanCfg.wanGateway'),s('wanCfg.wanMask')))fail('O gateway WAN deve estar na mesma sub-rede do IP WAN.');
      const lan=obj(raw.lanCfg);if(lan.lanIP&&lan.lanMask&&subnet(s('wanCfg.wanIP'),String(lan.lanIP),String(lan.lanMask)))fail('As redes WAN e LAN não podem se sobrepor.');
    }
    const maxMtu=['pppoe','pppoe2'].includes(type)?1492:['pptp','l2tp'].includes(type)?1460:1500;if(Number(get('wanAdvCfg.wanMTU'))>maxMtu)fail(`O MTU máximo desta conexão é ${maxMtu}.`);
    if(!enabled('wanCfg.wanDnsAuto')&&!s('wanCfg.wanDns1'))fail('Informe o DNS primário quando o DNS automático estiver desligado.');
    if(s('wanAdvCfg.macClone')==='manual'&&!macAddress.safeParse(s('wanAdvCfg.macAddr')).success)fail('Informe um MAC personalizado válido.');
  }
  if(spec.id==='lan'){
    const address=s('lanCfg.lanIP'),mask=s('lanCfg.lanMask');if(!unicast(address,mask))fail('O IP LAN deve ser um endereço de host válido.');
    if(enabled('lanCfg.dhcpEn')){const start=s('lanCfg.startIP'),end=s('lanCfg.endIP');if(!ipv4.safeParse(start).success||!ipv4.safeParse(end).success||!subnet(start,address,mask)||!subnet(end,address,mask)||!unicast(start,mask)||!unicast(end,mask)||ipn(start)>=ipn(end))fail('O intervalo DHCP deve estar na sub-rede LAN, em ordem crescente.');if(ipn(address)>=ipn(start)&&ipn(address)<=ipn(end))fail('O intervalo DHCP não pode incluir o IP do roteador.');}
    const reservations=rows(get('staticIPList'));duplicate(reservations.map(r=>r.mac),'Reservas de MAC');duplicate(reservations.map(r=>r.ip),'Reservas de IP');for(const r of reservations)if(r.ip===address||!subnet(String(r.ip),address,mask)||!unicast(String(r.ip),mask))fail('As reservas devem usar IPs válidos da LAN e diferentes do IP do roteador.');
    const wan=obj(raw.wanStatus);if(wan.wanIP&&wan.wanMask&&subnet(address,String(wan.wanIP),String(wan.wanMask)))fail('As redes LAN e WAN não podem se sobrepor.');
  }
  if(spec.id==='remote-web'&&enabled('remoteWeb.remoteEn')){const address=s('remoteWeb.remoteIP');if(!ipv4.safeParse(address).success||address==='0.0.0.0'||address==='255.255.255.255')fail('Defina um IP de origem específico para o gerenciamento remoto.');}
  if(spec.id==='dmz'&&enabled('dmzCfg.dmzEn')){const lan=obj(raw.lanCfg),address=s('dmzCfg.dmzIP');if(!ipv4.safeParse(address).success||address===lan.lanIP||!subnet(address,String(lan.lanIP),String(lan.lanMask))||!unicast(address,String(lan.lanMask)))fail('O host DMZ deve ser um dispositivo válido da LAN.');}
  if(spec.id==='port-forwarding'){
    const list=rows(get('portList')),lan=obj(raw.lanCfg);for(const row of list){if(row.intranetIP===lan.lanIP||!subnet(String(row.intranetIP),String(lan.lanIP),String(lan.lanMask))||!unicast(String(row.intranetIP),String(lan.lanMask)))fail('O IP de destino da porta deve pertencer à LAN.');const a=String(row.intranetPort).split('-').map(Number),b=String(row.extranetPort).split('-').map(Number);if((a[1]??a[0])-a[0]!==((b[1]??b[0])-b[0]))fail('Os intervalos de portas interna e externa devem ter a mesma quantidade de portas.');}
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=String(list[i].extranetPort).split('-').map(Number),b=String(list[j].extranetPort).split('-').map(Number);if(list[i].protocol!==list[j].protocol&&list[i].protocol!=='both'&&list[j].protocol!=='both')continue;if(a[0]<=(b[1]??b[0])&&b[0]<=(a[1]??a[0]))fail('Há regras com portas externas sobrepostas.');}
  }
  if(spec.id==='mac-filter'){
    const black=rows(get('macFilter.blackList')),white=rows(get('macFilter.whiteList'));duplicate(black.map(r=>r.mac),'Lista de bloqueio');duplicate(white.map(r=>r.mac),'Lista de permissão');
    const local=String(obj(raw.localhost).mac??'').toUpperCase();if(enabled('macFilter.macFilterEn')){if(!local)fail('Não foi possível identificar este computador para validar o filtro com segurança.','UNSUPPORTED');if(s('macFilter.curFilterMode')==='deny'&&black.some(r=>String(r.mac).toUpperCase()===local))fail('Não é permitido bloquear o computador que está administrando a rede.');if(s('macFilter.curFilterMode')==='allow'&&!white.some(r=>String(r.mac).toUpperCase()===local))fail('Inclua este computador na lista de permissão para manter o acesso.');}
  }
  if(spec.id==='vpn-server'){
    if(enabled('vpnServer.serverEn')&&(!ipv4.safeParse(s('vpnServer.startIP')).success||!ipv4.safeParse(s('vpnServer.endIP')).success||ipn(s('vpnServer.startIP'))>ipn(s('vpnServer.endIP'))))fail('Defina um intervalo de endereços válido para a VPN.');
    const accounts=rows(get('vpnAccountList'));duplicate(accounts.map(r=>r.username),'Usuários VPN');if(accounts.some(r=>!String(r.username).trim()))fail('Informe um usuário em cada conta VPN.');
  }
  if(spec.id==='vpn-client'&&enabled('vpnClient.clientEn')&&(!s('vpnClient.domain')||!s('vpnClient.username')))fail('Informe servidor e usuário da VPN.');
  if(spec.id==='tr069'&&enabled('tr069Cfg.tr069En')&&!s('tr069Cfg.acsAddr'))fail('Informe a URL do servidor ACS.');
  if(spec.id==='ddns'&&enabled('ddnsCfg.ddnsEn')&&!s('ddnsCfg.username'))fail('Informe o usuário do serviço DDNS.');
  if(spec.id==='cloud'&&enabled('cloudManage.cloudEn')&&!s('cloudManage.account'))fail('Informe a conta Tenda já vinculada ao roteador.');
  if(spec.id==='parental'){
    const groups=rows(get('parentControlList'));duplicate(groups.map(r=>r.groupName),'Nomes dos grupos');const allMacs:string[]=[];
    for(const g of groups){if(!String(g.groupName).trim())fail('Informe o nome de cada grupo.');const deviceMacs=lines(g.deviceMacs);if(!deviceMacs.length||deviceMacs.length>64||deviceMacs.some(m=>!macAddress.safeParse(m).success))fail('Cada grupo deve conter entre 1 e 64 MACs válidos.');allMacs.push(...deviceMacs);
      const times=lines(g.allowedTimes);if(g.timeEn===true&&(!times.length||times.length>10))fail('Informe entre 1 e 10 períodos por grupo.');for(const t of times){const [period,days]=t.split('|').map(s=>s.trim());if(!period||!days||!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(period)||!/^([1-7](,[1-7])*)$/.test(days)||new Set(days.split(',')).size!==days.split(',').length)fail('Use horários no formato HH:MM-HH:MM | 1,2,3.');}
      const urls=lines(g.urls);if(urls.length>10||urls.some(u=>u.length>128||/[\s<>"'\\]/.test(u)))fail('Informe até 10 sites ou palavras válidas, sem espaços ou marcação.');duplicate(urls,'Sites');
    }duplicate(allMacs,'Dispositivos dos grupos');
  }
  if(spec.id==='system-time'&&s('systemTime.timeType')==='manual'&&!s('systemTime.time'))fail('Informe a data e hora manual.');
  if(spec.id==='work-mode'&&['wisp','apclient'].includes(s('workMode.workMode'))){if(getPath(raw,'workMode.meshBtnEn')===true||getPath(raw,'meshBtn.meshBtnEn')===true)fail('Desative o botão Mesh antes de mudar para um modo de repetição.');if(!s('workMode.ssid').trim())fail('Informe o nome da rede de origem.');const password=s('workMode.wpapsk_key')||String(getPath(raw,'workMode.wpapsk_key')??'');if(s('workMode.wpapsk_type')!=='none'&&(password.length<8||password.length>63))fail('A senha da rede de origem deve ter de 8 a 63 caracteres.');if(s('workMode.wifi_chkHz')==='2'&&!['wpa3sae'].includes(s('workMode.wpapsk_type')))fail('A rede de origem em 6 GHz deve usar WPA3-SAE.');}
}

function buildPayload(spec:FeatureSpec,values:Values,raw:Record<string,unknown>):Record<string,unknown>{
  const payload:Record<string,unknown>={};
  for(const f of spec.fields){
    const old=getPath(raw,f.key);let value:unknown=values[f.key];
    if(f.key==='wifiGuest.guestSecurityMode')continue;
    if(f.readonly){if(!same(value,normalizeScalar(old,f,true)))fail('Um campo somente de leitura foi alterado.');continue;}
    if(old===undefined&&spec.id!=='work-mode'){if(!same(value,f.fallback))fail(`O firmware não oferece o campo “${f.label}” neste contexto.`,'UNSUPPORTED');continue;}
    if(f.secret&&value==='')value=old;
    if(f.key==='wifiTime.wifiTimeDate')value=daysToMask(String(value));
    if(f.key==='ipv6Cfg.wanIP')value=String(value)?[String(value)]:[];
    setPath(payload,f.key,Array.isArray(value)?value:wireScalar(value as JsonValue,old));
  }
  for(const t of spec.tables??[]){
    const original=rows(getPath(raw,t.key)),input=rows(values[t.key]),output:Record<string,unknown>[]=[];
    if(t.key==='wifiWpsList'){
      if(input.length!==original.length||input.some(row=>!original.some(old=>old.sn===row.sn)))fail('A lista de nós WPS foi alterada. Atualize a página.','CONFLICT');
      const selected=input.filter(row=>row.start===true);if(selected.length!==1)fail('Marque exatamente um nó para iniciar o WPS.');const old=original.find(row=>row.sn===selected[0].sn);if(!old)fail('Nó WPS não encontrado.','CONFLICT');payload.wifiWpsList=[{sn:old.sn,action:'wps'}];continue;
    }
    if(t.identity)duplicate(input.map(row=>String(row[t.identity!]??'')).filter(Boolean),t.label);
    let nextId=original.reduce((n,r)=>Math.max(n,Number(r.id)||0),-1)+1;
    for(const row of input){
      const old=t.identity?original.find(r=>r.operateType!=='system'&&String(r[t.identity!])===String(row[t.identity!]??'')):undefined;
      if(t.fields.some(f=>f.key==='id')&&row.id!==''&&!old)fail('Identificador de regra não pertence ao estado atual. Atualize a página.','CONFLICT');
      const item:Record<string,unknown>={};
      for(const f of t.fields){let value=row[f.key];if(f.readonly&&f.key!=='id'&&!same(value,normalizeScalar(old?.[f.key],f,true)))fail('Um campo de regra somente de leitura foi alterado.');if(f.secret&&value===''){if(!old?.[f.key])fail(`Informe “${f.label}” para a nova regra.`);value=old[f.key];}item[f.key]=wireScalar(value as JsonValue,old?.[f.key]);}
      if(t.fields.some(f=>f.key==='id'))item.id=old?old.id:nextId++;
      if(t.key==='staticRouteList'){item.ifname='WAN1';if(old?.operateType)item.operateType=old.operateType;const mask=String(item.mask);item.network=String(item.network).split('.').map((n,i)=>Number(n)&Number(mask.split('.')[i])).join('.');}
      if(t.key==='parentControlList'){
        item.deviceList=lines(row.deviceMacs).map(mac=>({mac:mac.toUpperCase(),hostname:findKnownDevice(raw,mac)}));
        item.allowDateList=lines(row.allowedTimes).map(text=>{const [accessTime,days]=text.split('|').map(s=>s.trim());return {accessTime,accessDate:daysToMask(days)};});item.urlList=lines(row.urls);delete item.deviceMacs;delete item.allowedTimes;delete item.urls;
      }
      output.push(item);
    }
    if(t.key==='staticRouteList')output.push(...original.filter(r=>r.operateType==='system'));
    setPath(payload,t.key,output);
  }
  if(spec.id==='wifi'){
    const config=obj(payload.wifiBasicCfg),triple=values['wifiBasicCfg.tripleBand']===true,double=values['wifiBasicCfg.doubleBand']===true;if(triple||double){for(const suffix of triple?['_5g','_6g']:['_5g'])for(const key of ['wifiEn','wifiSSID','wifiHideSSID','wifiSecurityMode','wifiPwd'])config[key+suffix]=config[key];}
    if(triple&&!['wpa3sae','wpa3saeowe'].includes(String(config.wifiSecurityMode)))fail('Para unificar as três bandas, selecione WPA3-SAE.');
  }
  if(spec.id==='wan'){const config=obj(payload.wanCfg),advanced=obj(payload.wanAdvCfg);advanced.wanType=config.wanType;for(const key of ['wanDnsAuto','wanDns1','wanDns2'])advanced[key]=config[key];config.action='connect';}
  if(spec.id==='guest'){const config=obj(payload.wifiGuest);config.guestDownSpeed=config.guestUpSpeed;if(values['wifiGuest.guestEn']===true){if(values['wifiGuest.guestSecurityMode']===false)config.guestPwd='';}else config.guestPwd=getPath(raw,'wifiGuest.guestPwd');}
  if(spec.id==='system-time'){
    const config=obj(payload.systemTime),original=obj(raw.systemTime);for(const key of ['startSummerTime','endSummerTime'])if(original[key]!==undefined)config[key]=original[key];
    if(values['systemTime.summerTimeEn']===true&&(!config.startSummerTime||!config.endSummerTime))fail('O firmware não retornou os períodos de horário de verão.','UNSUPPORTED');
  }
  if(spec.id==='work-mode'){const mode=obj(payload.workMode);if(['router','ap'].includes(String(mode.workMode)))payload.workMode={workMode:mode.workMode};else Object.assign(mode,{mac:'',handset:'1',security:mode.wpapsk_type==='none'?'none':'wpapsk'});}
  return payload;
}
function findKnownDevice(raw:Record<string,unknown>,mac:string):string {
  const targets=rows(raw.deviceList).flatMap(group=>[...rows(group.onlineList),...rows(group.offlineList),...rows(group.guestList)]);
  const found=targets.find(d=>String(d.mac??'').toUpperCase()===mac.toUpperCase());if(!found)fail('Um dos dispositivos do grupo não pertence à lista atual do roteador. Atualize os clientes.');return String(found.hostname??'');
}

export class FeatureService {
  private pending=new Map<string,Pending>();
  private uncertain=new Set<string>();
  private chain:Promise<unknown>=Promise.resolve();
  constructor(private provider:FeatureProvider,private now:()=>number=Date.now){}
  private spec(id:string):FeatureSpec {
    const found=catalog.find(f=>f.id===id)??fail('Configuração não reconhecida.','UNSUPPORTED');const c=this.provider.getConnection();
    return c.capabilities.length&&!c.capabilities.includes('wifi6')?{...found,fields:found.fields.filter(f=>!f.key.endsWith('_6g')&&!f.key.endsWith('.enablePsc')&&!f.key.endsWith('.tripleBand'))}:found;
  }
  private identity():string{const c=this.provider.getConnection();return stable({host:c.host,demo:c.demo,model:c.model,firmware:c.firmware});}
  private available(spec:FeatureSpec,write=false):void {
    const connection=this.provider.getConnection();if(!connection.connected)fail('Conecte-se ao roteador para continuar.','AUTH');
    if(write&&!connection.demo&&(!/RX27[ _-]?PRO/i.test(connection.model)||!/^V16\.03\.28\.20(?:_multi)?$/i.test(connection.firmware)))fail('Alterações estão habilitadas apenas para o RX27 Pro com firmware V16.03.28.20 validado.','UNSUPPORTED');
    if(spec.routerOnly&&connection.mode!=='router')fail('Esta configuração exige modo roteador.','UNSUPPORTED');
    const required=capabilityFor(spec.id);if(required&&connection.capabilities.length&&!connection.capabilities.includes(required))fail('O roteador não anunciou suporte a este recurso.','UNSUPPORTED');
  }
  definitions():FeatureDefinition[]{const c=this.provider.getConnection();return catalog.map(base=>{const spec=this.spec(base.id),capability=capabilityFor(spec.id),modeUnavailable=spec.routerOnly&&c.mode!=='router',capabilityUnavailable=!!(capability&&c.capabilities.length&&!c.capabilities.includes(capability));return {...publicDefinition(spec),available:!modeUnavailable&&!capabilityUnavailable,unavailableReason:modeUnavailable?'Disponível no modo roteador.':capabilityUnavailable?'O firmware não anunciou este recurso.':undefined};});}
  private async raw(spec:FeatureSpec):Promise<Record<string,unknown>>{const modules=knownModules(spec);const raw=await this.provider.readModules(modules,spec.id==='cloud'?{action:'basic'}:undefined);for(const module of modules.filter(m=>!(spec.related??[]).includes(m)))if(!Object.prototype.hasOwnProperty.call(raw,module))fail('O firmware não retornou os dados desta configuração.','UNSUPPORTED');return raw;}
  async read(id:string):Promise<FeatureSnapshot>{const spec=this.spec(id);this.available(spec);const raw=await this.raw(spec);this.uncertain.delete(id);return {id,values:project(raw,spec,true),revision:revision(raw,spec),sampledAt:new Date(this.now()).toISOString()};}
  async prepare(input:{id:string;values:Values;revision:string}):Promise<ChangePreview>{
    const parsed=z.object({id:z.string().min(1).max(64),values:z.record(z.string(),z.unknown()),revision:z.string().regex(/^[0-9a-f]{64}$/)}).strict().safeParse(input);if(!parsed.success)fail('Solicitação de alteração inválida.');
    const spec=this.spec(input.id);this.available(spec,true);if(this.uncertain.has(spec.id))fail('Atualize esta configuração antes de uma nova tentativa; o resultado anterior foi incerto.','UNCERTAIN');
    const validation=schemaFor(spec).safeParse(input.values);if(!validation.success)fail(validation.error.issues[0]?.message??'Configuração inválida.');
    const values=validation.data as Values;const raw=await this.raw(spec);if(revision(raw,spec)!==input.revision)fail('A configuração mudou no roteador. Atualize a tela antes de salvar.','CONFLICT');
    for(const key of Object.keys(values))if(!key.split('.').every(protect))fail('Campo não permitido.');
    validateBusiness(spec,values,raw);const payload=buildPayload(spec,values,raw);const old=project(raw,spec,true),expected=project({...raw,...payload},spec,false);
    const changed=Object.keys(values).filter(key=>!same(values[key],old[key]));if(!changed.length)fail('Nenhuma alteração para aplicar.');
    this.expire();if(this.pending.size>=12)fail('Há muitas revisões abertas. Cancele uma revisão para continuar.');
    const id='feature:'+randomUUID(),expires=this.now()+120_000;this.pending.set(id,{spec,payload,revision:input.revision,expected,changed,expires,connection:this.identity()});
    const summary:string[]=[];for(const key of changed){const field=spec.fields.find(f=>f.key===key),table=spec.tables?.find(t=>t.key===key);if(field)summary.push(field.secret?`${field.label}: nova senha informada.`:`${field.section?field.section+' · ':''}${field.label}: ${displayField(field,values[key])}.`);else if(table)summary.push(...tableSummary(table,rows(old[key]),rows(values[key])));}
    return {id,title:`Aplicar: ${spec.title}`,summary,risk:spec.risk,expiresAt:new Date(expires).toISOString(),warning:spec.risk==='disconnect'?'A conexão com a rede pode cair. Mantenha acesso por cabo e confirme o endereço para reconectar.':spec.risk==='security'?'Esta alteração modifica o acesso à rede ou sua proteção. Confira as regras antes de confirmar.':undefined};
  }
  assertPending(id:string):void{const p=this.pending.get(id);if(!p||p.expires<this.now()||p.connection!==this.identity())fail('A revisao expirou ou ja foi utilizada.','CONFLICT');}
  async apply(id:string):Promise<ApplyResult>{
    if(typeof id!=='string'||!id.startsWith('feature:')||id.length>80)fail('Revisão inválida.');const pending=this.pending.get(id);this.pending.delete(id);if(!pending||pending.expires<this.now())fail('A revisão expirou ou já foi utilizada. Revise novamente.','CONFLICT');
    const work=async():Promise<ApplyResult>=>{
      this.available(pending.spec,true);if(pending.connection!==this.identity())fail('A conexão mudou. Prepare uma nova revisão.','CONFLICT');
      const before=await this.raw(pending.spec);if(revision(before,pending.spec)!==pending.revision)fail('A configuração foi alterada após a revisão. Atualize e revise novamente.','CONFLICT');
      try{const result=await this.provider.writeModules(pending.payload);const code=Number(result.errCode??0);if(code===100)return {message:'Configuração aceita. O roteador informou que será reiniciado; entre novamente após a conclusão.',reconnect:true};if(code===102)fail('O equipamento informou uma restauração inesperada. Verifique o estado antes de continuar.','UNCERTAIN');if(code!==0)fail('O roteador recusou a alteração.','ROUTER');}
      catch(error){if((error as {code?:string}).code==='UNCERTAIN'||(error as {code?:string}).code==='TIMEOUT'){this.uncertain.add(pending.spec.id);try{const after=project(await this.raw(pending.spec),pending.spec,false);if(pending.changed.every(k=>same(after[k],pending.expected[k]))){this.uncertain.delete(pending.spec.id);return {message:'Alteração confirmada por uma nova consulta ao roteador.',reconnect:pending.spec.risk==='disconnect'};}}catch{/* Remain uncertain; do not retry a write. */}fail('A resposta não chegou. O resultado é incerto; atualize a configuração antes de tentar novamente.','UNCERTAIN');}throw error;}
      if(pending.spec.risk==='disconnect'||pending.spec.id==='wps')return {message:pending.spec.id==='wps'?'Pareamento WPS solicitado. Consulte o estado novamente em alguns segundos.':'Configuração enviada. Reconecte-se se a rede ou o endereço do roteador mudar.',reconnect:pending.spec.risk==='disconnect'};
      try{const after=project(await this.raw(pending.spec),pending.spec,false);if(!pending.changed.every(k=>same(after[k],pending.expected[k]))) {this.uncertain.add(pending.spec.id);fail('O roteador respondeu, mas a leitura ainda não confirmou os valores. Atualize antes de repetir.','UNCERTAIN');}}catch(error){if((error as {code?:string}).code==='UNCERTAIN')throw error;this.uncertain.add(pending.spec.id);fail('A alteração foi enviada, mas a leitura de confirmação falhou. Atualize antes de repetir.','UNCERTAIN');}
      return {message:'Configuração aplicada e conferida no roteador.',reconnect:false};
    };
    const result=this.chain.then(work,work);this.chain=result.catch(()=>{});return result;
  }
  cancel(id:string):void{if(typeof id==='string')this.pending.delete(id);}
  clear():void{this.pending.clear();this.uncertain.clear();}
  private expire():void{for(const [id,p] of this.pending)if(p.expires<this.now())this.pending.delete(id);}
}
function display(value:unknown):string {if(value===true)return 'ativado';if(value===false)return 'desativado';if(value===''||value===null||value===undefined)return 'não informado';return String(value).replace(/\r?\n/g,'; ').slice(0,2000);}
function displayField(field:FieldSpec,value:unknown):string {return field.secret?'nova senha informada':field.options?.find(option=>option.value===String(value))?.label??display(value);}
function tableSummary(table:TableSpec,before:Record<string,unknown>[],after:Record<string,unknown>[]):string[]{
  const result:string[]=[],matched=new Set<Record<string,unknown>>();
  const caption=(row:Record<string,unknown>,index:number)=>{const key=['groupName','hostname','username','nodeName','intranetIP','network','mac'].find(k=>table.fields.some(f=>f.key===k&&!f.secret)&&row[k]);return key?display(row[key]):`regra ${index+1}`;};
  after.forEach((row,index)=>{
    const old=table.identity&&row[table.identity]!==''?before.find(item=>String(item[table.identity!])===String(row[table.identity!])):undefined;
    if(old)matched.add(old);
    const changes=table.fields.filter(field=>!field.readonly&&(!old||!same(row[field.key],old[field.key]))).map(field=>`${field.label}: ${displayField(field,row[field.key])}`);
    if(changes.length)result.push(`${table.label} · ${old?'Alterar':'Adicionar'} ${caption(row,index)} — ${changes.join(' | ')}.`);
  });
  before.forEach((row,index)=>{if(!matched.has(row))result.push(`${table.label} · Remover ${caption(row,index)}.`);});
  if(!result.length)result.push(`${table.label}: nova ordem das ${after.length} regras.`);
  return result;
}
function capabilityFor(id:string):string|undefined{return ({wps:'wps',guest:'guest',ipv6:'ipv6','vpn-server':'vpn','vpn-client':'vpn',ddns:'ddns',upnp:'upnp',tr069:'tr069',firewall:'firewall','mesh-button':'mesh'} as Record<string,string>)[id];}

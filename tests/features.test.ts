import { describe, it, expect, vi } from 'vitest';
import { FeatureService, createDemoFeatureModules, type FeatureProvider } from '../src/main/features';
import type { ConnectionStatus, Values } from '../src/shared/types';

class Provider implements FeatureProvider {
  data=createDemoFeatureModules();
  status:ConnectionStatus={connected:true,demo:true,host:'demo',model:'RX27 PRO',firmware:'V16.03.28.20_multi',hardware:'V1.0',mode:'router',capabilities:['wifi24','wifi5','wifi6','mesh','guest','wps','ipv6','vpn','ddns','upnp','tr069','firewall']};
  writes:Record<string,unknown>[]=[];
  getConnection(){return this.status;}
  async readModules(_modules:string[]){return structuredClone(this.data);}
  async writeModules(payload:Record<string,unknown>){this.writes.push(structuredClone(payload));Object.assign(this.data,structuredClone(payload));return {errCode:0};}
}
async function preview(service:FeatureService,id:string,changes:Values){const snapshot=await service.read(id);return service.prepare({id,values:{...snapshot.values,...changes},revision:snapshot.revision});}

describe('Feature validation and preparation',()=>{
  it('treats the documented reboot acknowledgment as a reconnect transition',async()=>{
    const provider=new Provider(),service=new FeatureService(provider);provider.writeModules=async payload=>{provider.writes.push(payload);return {errCode:100};};
    const p=await preview(service,'led',{'ledCfg.ledType':'disabled'});await expect(service.apply(p.id)).resolves.toMatchObject({reconnect:true});expect(provider.writes).toHaveLength(1);
  });
  it('derives guest security from the existing password and never sends the virtual UI flag',async()=>{
    const provider=new Provider(),service=new FeatureService(provider);const guest=provider.data.wifiGuest as Record<string,unknown>;delete guest.guestSecurityMode;guest.guestEn=true;
    const snapshot=await service.read('guest');expect(snapshot.values['wifiGuest.guestSecurityMode']).toBe(true);
    const p=await preview(service,'guest',{'wifiGuest.guestSecurityMode':false,'wifiGuest.guestUpSpeed':8});await service.apply(p.id);
    const sent=provider.writes[0].wifiGuest as Record<string,unknown>;expect(sent).not.toHaveProperty('guestSecurityMode');expect(sent.guestPwd).toBe('');expect(Number(sent.guestUpSpeed)).toBe(8);expect(sent.guestDownSpeed).toBe(sent.guestUpSpeed);
  });
  it('requires an explicit valid password when protecting an open guest network',async()=>{
    const provider=new Provider(),service=new FeatureService(provider);const guest=provider.data.wifiGuest as Record<string,unknown>;delete guest.guestSecurityMode;guest.guestEn=true;guest.guestPwd='';
    expect((await service.read('guest')).values['wifiGuest.guestSecurityMode']).toBe(false);
    await expect(preview(service,'guest',{'wifiGuest.guestSecurityMode':true})).rejects.toMatchObject({code:'VALIDATION'});
    const p=await preview(service,'guest',{'wifiGuest.guestSecurityMode':true,'wifiGuest.guestPwd':'Synthetic-Secure1'});expect(JSON.stringify(p)).not.toContain('Synthetic-Secure1');await service.apply(p.id);expect((provider.writes[0].wifiGuest as Record<string,unknown>).guestPwd).toBe('Synthetic-Secure1');
  });
  it('does not expose router passwords or include them in confirmations',async()=>{
    const provider=new Provider(),service=new FeatureService(provider);const snapshot=await service.read('wifi');
    expect(snapshot.values['wifiBasicCfg.wifiPwd']).toBe('');expect(JSON.stringify(snapshot)).not.toContain('DemoOnly-1234');
    const p=await preview(service,'wifi',{'wifiBasicCfg.wifiPwd':'NewSecure-1234'});expect(JSON.stringify(p)).not.toContain('NewSecure-1234');expect(p.summary.join(' ')).toContain('nova senha');
  });
  it('keeps an unchanged password on a legitimate settings change',async()=>{
    const provider=new Provider(),service=new FeatureService(provider);const p=await preview(service,'wifi',{'wifiBasicCfg.wifiSSID':'Minha rede'});await service.apply(p.id);
    expect((provider.data.wifiBasicCfg as Record<string,unknown>).wifiPwd).toBe('DemoOnly-1234');
  });
  it('rejects unknown modules, fields, and table row properties',async()=>{
    const service=new FeatureService(new Provider());await expect(service.read('arbitrary')).rejects.toMatchObject({code:'UNSUPPORTED'});
    await expect(preview(service,'firewall',{'injected':true})).rejects.toMatchObject({code:'VALIDATION'});
    const snapshot=await service.read('port-forwarding');(snapshot.values.portList as Record<string,unknown>[])[0].command='execute';await expect(service.prepare({id:snapshot.id,revision:snapshot.revision,values:snapshot.values})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('enforces the SSID limit in UTF-8 bytes, not character count',async()=>{
    const service=new FeatureService(new Provider());await expect(preview(service,'wifi',{'wifiBasicCfg.wifiSSID':'á'.repeat(17)})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('validates DHCP subnet and avoids handing out the router address',async()=>{
    const service=new FeatureService(new Provider());await expect(preview(service,'lan',{'lanCfg.startIP':'192.168.1.10'})).rejects.toMatchObject({code:'VALIDATION'});
    await expect(preview(service,'lan',{'lanCfg.startIP':'192.168.0.1'})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('rejects externally overlapping port maps and mismatched ranges',async()=>{
    const service=new FeatureService(new Provider()),snapshot=await service.read('port-forwarding');const values={...snapshot.values,portList:[{id:'',intranetIP:'192.168.0.120',intranetPort:'80-81',extranetPort:'8000',protocol:'tcp'}]};await expect(service.prepare({id:snapshot.id,revision:snapshot.revision,values})).rejects.toMatchObject({code:'VALIDATION'});
    values.portList=[{id:'',intranetIP:'192.168.0.120',intranetPort:'80',extranetPort:'8000',protocol:'both'},{id:'',intranetIP:'192.168.0.121',intranetPort:'90',extranetPort:'8000',protocol:'tcp'}];await expect(service.prepare({id:snapshot.id,revision:snapshot.revision,values})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('prevents locking the managing computer out through MAC filters',async()=>{
    const service=new FeatureService(new Provider());await expect(preview(service,'mac-filter',{'macFilter.macFilterEn':true,'macFilter.blackList':[{hostname:'Desktop',mac:'02:00:00:00:00:01'}]})).rejects.toMatchObject({code:'VALIDATION'});
    await expect(preview(service,'mac-filter',{'macFilter.macFilterEn':true,'macFilter.curFilterMode':'allow'})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('requires one specific IP when enabling remote web administration',async()=>{
    const service=new FeatureService(new Provider());await expect(preview(service,'remote-web',{'remoteWeb.remoteEn':true,'remoteWeb.remoteIP':'0.0.0.0'})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('preserves VPN account secrets by row identity when rows are reordered',async()=>{
    const provider=new Provider();provider.data.vpnAccountList=[{id:0,username:'a',password:'Secret-a',enable:true},{id:1,username:'b',password:'Secret-b',enable:true}];const service=new FeatureService(provider),snapshot=await service.read('vpn-server');const list=snapshot.values.vpnAccountList as Record<string,unknown>[];const p=await service.prepare({id:snapshot.id,revision:snapshot.revision,values:{...snapshot.values,vpnAccountList:[list[1],list[0]] as never}});await service.apply(p.id);
    expect((provider.data.vpnAccountList as Record<string,unknown>[]).map(r=>[r.username,r.password])).toEqual([['b','Secret-b'],['a','Secret-a']]);
  });
  it('rejects forged table identifiers',async()=>{
    const service=new FeatureService(new Provider());await expect(preview(service,'port-forwarding',{portList:[{id:'999',intranetIP:'192.168.0.120',intranetPort:'80',extranetPort:'8000',protocol:'tcp'}]})).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('only allows current known clients in parental groups',async()=>{
    const service=new FeatureService(new Provider()),snapshot=await service.read('parental');const list=structuredClone(snapshot.values.parentControlList) as Record<string,unknown>[];list[0].deviceMacs='02:00:00:00:00:ff';await expect(service.prepare({id:snapshot.id,revision:snapshot.revision,values:{parentControlList:list as never}})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('does not accept an out-of-country radio channel',async()=>{
    const service=new FeatureService(new Provider());await expect(preview(service,'wifi-advanced',{'wifiAdvCfg.wifiChannel_5g':'165','wifiAdvCfg.wifiBandwidth_5g':'160'})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('fails closed on unverified firmware and mode-dependent functions',async()=>{
    const provider=new Provider();provider.status.demo=false;provider.status.firmware='V99';const service=new FeatureService(provider);await expect(preview(service,'firewall',{'firewallCfg.pingAntiEn':false})).rejects.toMatchObject({code:'UNSUPPORTED'});provider.status.mode='ap';expect(service.definitions().find(f=>f.id==='firewall')?.available).toBe(false);await expect(service.read('firewall')).rejects.toMatchObject({code:'UNSUPPORTED'});
  });
  it('constructs a bounded WPS action for a known node',async()=>{
    const provider=new Provider(),service=new FeatureService(provider),snapshot=await service.read('wps');const list=structuredClone(snapshot.values.wifiWpsList) as Record<string,unknown>[];list[0].start=true;const p=await service.prepare({id:snapshot.id,revision:snapshot.revision,values:{wifiWpsList:list as never}});await service.apply(p.id);expect(provider.writes[0]).toEqual({wifiWpsList:[{sn:'primary',action:'wps'}]});
  });
  it('does not treat string false flags as a request to unify Wi-Fi bands',async()=>{
    const provider=new Provider();Object.assign(provider.data.wifiBasicCfg as object,{doubleBand:'false',tripleBand:'false'});const service=new FeatureService(provider),p=await preview(service,'wifi',{'wifiBasicCfg.wifiSSID':'Nova 2G'});await service.apply(p.id);expect((provider.data.wifiBasicCfg as Record<string,unknown>).wifiSSID_5g).toBe('Casa Felipe 5G');
  });
  it('does not allow duplicated row identities or modification of system routes',async()=>{
    const provider=new Provider();provider.data.staticRouteList=[{id:3,network:'0.0.0.0',mask:'0.0.0.0',gateway:'192.168.0.254',ifname:'WAN1',operateType:'system'}];const service=new FeatureService(provider);
    await expect(preview(service,'vpn-server',{vpnAccountList:[{id:'0',username:'a',password:'',enable:true},{id:'0',username:'b',password:'',enable:true}]})).rejects.toMatchObject({code:'VALIDATION'});
    await expect(preview(service,'static-routes',{staticRouteList:[{id:'3',network:'10.0.0.0',mask:'255.0.0.0',gateway:'192.168.0.250'}]})).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('shows concrete table additions and removals with human enum labels and redacted secrets',async()=>{
    const provider=new Provider(),service=new FeatureService(provider);const p=await preview(service,'port-forwarding',{portList:[{id:'',intranetIP:'192.168.0.125',intranetPort:'443',extranetPort:'8443',protocol:'tcp'}]});expect(p.summary.join('\n')).toContain('Adicionar 192.168.0.125');expect(p.summary.join('\n')).toContain('Porta externa: 8443');expect(p.summary.join('\n')).toContain('Protocolo: TCP');expect(p.summary.join('\n')).toContain('Remover 192.168.0.120');
    const q=await preview(service,'vpn-server',{vpnAccountList:[{id:'0',username:'demo',password:'ChangedSecret1234',enable:true}]});expect(q.summary.join('\n')).toContain('Senha: nova senha informada');expect(JSON.stringify(q)).not.toContain('ChangedSecret1234');
  });
  it('omits unsupported bands and disables features absent from capability flags',async()=>{
    const provider=new Provider();provider.status.capabilities=['wifi24','wifi5'];const service=new FeatureService(provider),defs=service.definitions();expect(defs.find(f=>f.id==='wifi')?.fields.some(f=>f.key.endsWith('_6g'))).toBe(false);expect(defs.find(f=>f.id==='wps')?.available).toBe(false);expect((await service.read('wifi')).values).not.toHaveProperty('wifiBasicCfg.wifiSSID_6g');await expect(service.read('wps')).rejects.toMatchObject({code:'UNSUPPORTED'});
  });
});

describe('Confirmation lifecycle and uncertain results',()=>{
  it('checks for a changed router revision before preparing and applying',async()=>{
    const provider=new Provider(),service=new FeatureService(provider),snapshot=await service.read('firewall');(provider.data.firewallCfg as Record<string,unknown>).tcpAntiEn=false;
    await expect(service.prepare({id:snapshot.id,revision:snapshot.revision,values:{...snapshot.values,'firewallCfg.pingAntiEn':false}})).rejects.toMatchObject({code:'CONFLICT'});
    const p=await preview(service,'firewall',{'firewallCfg.pingAntiEn':false});(provider.data.firewallCfg as Record<string,unknown>).udpAntiEn=false;await expect(service.apply(p.id)).rejects.toMatchObject({code:'CONFLICT'});expect(provider.writes).toHaveLength(0);
  });
  it('consumes confirmations once and supports expiry and cancellation',async()=>{
    const provider=new Provider();let now=1000;const service=new FeatureService(provider,()=>now),p=await preview(service,'firewall',{'firewallCfg.pingAntiEn':false});await service.apply(p.id);await expect(service.apply(p.id)).rejects.toMatchObject({code:'CONFLICT'});
    const p2=await preview(service,'firewall',{'firewallCfg.pingAntiEn':true});now+=120001;await expect(service.apply(p2.id)).rejects.toMatchObject({code:'CONFLICT'});
    const p3=await preview(service,'firewall',{'firewallCfg.pingAntiEn':true});service.cancel(p3.id);await expect(service.apply(p3.id)).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('queries after a lost response and confirms an applied write without retrying',async()=>{
    const provider=new Provider(),original=provider.writeModules.bind(provider);provider.writeModules=vi.fn(async payload=>{await original(payload);throw Object.assign(new Error('timeout'),{code:'UNCERTAIN'});});const service=new FeatureService(provider),p=await preview(service,'firewall',{'firewallCfg.pingAntiEn':false});await expect(service.apply(p.id)).resolves.toMatchObject({reconnect:false});expect(provider.writeModules).toHaveBeenCalledTimes(1);
  });
  it('does not retry a lost, unconfirmed write and requires a refresh',async()=>{
    const provider=new Provider();provider.writeModules=vi.fn(async()=>{throw Object.assign(new Error('timeout'),{code:'UNCERTAIN'});});const service=new FeatureService(provider),snapshot=await service.read('firewall'),input={id:snapshot.id,revision:snapshot.revision,values:{...snapshot.values,'firewallCfg.pingAntiEn':false}},p=await service.prepare(input);await expect(service.apply(p.id)).rejects.toMatchObject({code:'UNCERTAIN'});await expect(service.prepare(input)).rejects.toMatchObject({code:'UNCERTAIN'});expect(provider.writeModules).toHaveBeenCalledTimes(1);await service.read('firewall');await expect(service.prepare(input)).resolves.toHaveProperty('id');
  });
  it('serializes confirmation applications and rejects the second stale revision',async()=>{
    const provider=new Provider(),service=new FeatureService(provider),a=await preview(service,'firewall',{'firewallCfg.pingAntiEn':false}),b=await preview(service,'firewall',{'firewallCfg.tcpAntiEn':false});const result=await Promise.allSettled([service.apply(a.id),service.apply(b.id)]);expect(result[0].status).toBe('fulfilled');expect(result[1].status).toBe('rejected');expect(provider.writes).toHaveLength(1);
  });
  it('clears pending confirmations when the application disconnects',async()=>{
    const service=new FeatureService(new Provider()),p=await preview(service,'firewall',{'firewallCfg.pingAntiEn':false});service.clear();await expect(service.apply(p.id)).rejects.toMatchObject({code:'CONFLICT'});
  });
});

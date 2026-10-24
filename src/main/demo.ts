import type { ClientDevice, ConnectionStatus, MeshNode, Overview } from '../shared/types';
import { createDemoFeatureModules } from './features';
import { AppError } from './errors';

const clone = <T>(value: T): T => structuredClone(value);
const nodes: MeshNode[] = [
  { id: 'DEMO-RX27', name: 'Roteador principal', model: 'RX27 Pro', ip: '192.168.50.1', parentId: null, online: true, primary: true, clients: 5, quality: 'Excelente', band: 'Ethernet' },
  { id: 'DEMO-SALA', name: 'Sala de estar', model: 'RX12L Pro', ip: '192.168.50.2', parentId: 'DEMO-RX27', online: true, primary: false, clients: 3, quality: 'Excelente', band: '5 GHz' },
  { id: 'DEMO-ESCRITORIO', name: 'Escritório', model: 'RX12L Pro', ip: '192.168.50.3', parentId: 'DEMO-SALA', online: true, primary: false, clients: 2, quality: 'Bom', band: '5 GHz' },
  { id: 'DEMO-QUARTO', name: 'Quarto', model: 'RX12L Pro', ip: '192.168.50.4', parentId: 'DEMO-SALA', online: false, primary: false, clients: 0, quality: 'Offline', band: '5 GHz' },
];
const names = ['Computador', 'Smartphone', 'Smart TV', 'Notebook', 'Tablet', 'Console', 'Câmera', 'Caixa de som', 'Lâmpada', 'Relógio'];
export class DemoRouter {
  private active = true;
  private start = Date.now();
  private data: Record<string, unknown>;
  private devices: ClientDevice[] = names.map((name, i) => ({ id: `02:00:00:00:50:${(i + 16).toString(16).toUpperCase()}`, mac: `02:00:00:00:50:${(i + 16).toString(16).toUpperCase()}`, name, ip: `192.168.50.${100 + i}`, nodeId: nodes[Math.min(Math.floor(i / 4), 2)].id, nodeName: nodes[Math.min(Math.floor(i / 4), 2)].name, online: i !== 8, guest: i === 7, blocked: i === 9, local: i === 0, connection: i === 0 ? 'Ethernet' : i % 2 ? '5 GHz' : '2.4 GHz', upload: (i + 1) * 2310, download: (i + 1) * 34000, uploadLimit: 0, downloadLimit: 0, uptime: 3200 + i * 100 }));
  readonly writes: string[] = [];
  constructor() {
    this.data = {
      ...createDemoFeatureModules(),
      localhost: { mac: this.devices[0].mac, ip: this.devices[0].ip },
      workMode: { workMode: 'router' },
      systemCfg: { firmwareVersion: 'V16.03.28.20_multi', hardwareVersion: 'V1.0', deviceName: 'RX27 Pro' },
      wanStatus: { wanIP: '192.0.2.42', wanMask: '255.255.255.0', connectCode: '1', wanType: 'pppoe' },
      ipConfig: {},
      meshTopo: { sn: nodes[0].id, mac: '02:00:00:00:00:01', childNode: [] },
      deviceVersionList: nodes.map((n,i) => ({ sn: n.id, mac: `02:00:00:00:00:0${i+1}`, nodeName: n.name, nodeType: n.primary ? 'controller' : 'agent', ip: n.ip, nodeStatus: 'normal', versionInfo: { curSoftVersion: 'V16.03.28.20_multi', hasNewSoftVersion: false } })),
      systemLog: { systemLogList: [{ id: 1, time: new Date().toLocaleString('pt-BR'), type: 'Sistema', log: 'Ambiente de demonstração iniciado. Nenhuma conexão real foi realizada.' }] },
      scanNodeList: [],
    };
    Object.assign(this.data.wifiBasicCfg as object, { wifiSSID: 'Casa conectada', wifiSSID_5g: 'Casa conectada 5G', wifiSSID_6g: 'Casa conectada 6G' });
    Object.assign(this.data.lanCfg as object, { lanIP: '192.168.50.1', startIP: '192.168.50.100', endIP: '192.168.50.200' });
    this.data.staticIPList = [{ hostname: this.devices[0].name, ip: this.devices[0].ip, mac: this.devices[0].mac }];
    this.data.portList = [{ id: 0, intranetIP: '192.168.50.120', intranetPort: '8080', extranetPort: '18080', protocol: 'tcp' }];
    this.data.wifiWpsList = nodes.map(n => ({ sn: n.id, nodeName: n.name, wpsStatus: 'idle', leftTime: 0 }));
    if (!this.data.macFilter) this.data.macFilter = { macFilterEn: true, curFilterMode: 'deny', blackList: [{ hostname: names[9], mac: this.devices[9].mac }], whiteList: [] };
  }
  getConnection(): ConnectionStatus { return { connected: this.active, demo: true, host: '192.168.50.1', model: 'RX27 Pro', firmware: 'V16.03.28.20_multi', hardware: 'V1.0', mode: 'router', capabilities: ['wifi24', 'wifi5', 'wifi6', 'mesh', 'guest', 'ipv6', 'vpn', 'wps', 'ddns', 'upnp', 'tr069', 'firewall'] }; }
  async connect(): Promise<ConnectionStatus> { this.active = true; return this.getConnection(); }
  async disconnect(): Promise<void> { this.active = false; }
  private check() { if (!this.active) throw new AppError('AUTH', 'Conecte-se novamente para continuar.'); }
  async readModules(modules: string[], _params?: Record<string, string>): Promise<Record<string, unknown>> {
    this.check(); const result: Record<string, unknown> = { errCode: 0 };
    for (const module of modules) {
      if (module === 'deviceList' || module === 'deviceListNotNeedRate') result.deviceList = nodes.map(n => ({ sn: n.id, nodeName: n.name, onlineList: this.devices.filter(d => d.nodeId === n.id && d.online).map(d => this.wireDevice(d)), offlineList: this.devices.filter(d => d.nodeId === n.id && !d.online).map(d => this.wireDevice(d)) }));
      else if (module in this.data) result[module] = clone(this.data[module]);
      else throw new AppError('UNSUPPORTED', 'Este recurso não está disponível na demonstração.');
    }
    return result;
  }
  private wireDevice(d: ClientDevice) { return { mac: d.mac, hostname: d.name, ip: d.ip, sn: d.nodeId, upLimit: String(d.uploadLimit), downLimit: String(d.downloadLimit), controlEn: d.uploadLimit > 0 || d.downloadLimit > 0, upSpeed: String(d.upload / 1000), downSpeed: String(d.download / 1000), connectType: d.connection }; }
  async writeModules(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.check(); this.writes.push(...Object.keys(payload));
    for (const [module, value] of Object.entries(payload)) {
      if (module === 'setDeviceInfo') {
        const v = value as Record<string, unknown>; const d = this.devices.find(d => d.mac === String(v.mac).toUpperCase());
        if (d) { if (typeof v.hostname === 'string') d.name = v.hostname; if (v.upLimit != null) d.uploadLimit = Number(v.upLimit); if (v.downLimit != null) d.downloadLimit = Number(v.downLimit); }
      } else if (module === 'deviceVersionList') {
        const request = value as {action:string;sn?:string};
        const rows = this.data.deviceVersionList as {sn:string;nodeStatus:string;versionInfo:Record<string,unknown>}[];
        for (const row of rows.filter(r => !request.sn || request.sn === r.sn)) {
          if (request.action === 'queryversion') row.versionInfo = { ...row.versionInfo, hasNewSoftVersion: true, newSoftVersion: 'V16.03.28.21 (demonstração)' };
          else if (request.action === 'queryupgrade') row.nodeStatus = 'upgrading';
        }
      } else if (module === 'macFilter') {
        this.data[module] = clone(value); const v = value as { macFilterEn: boolean; blackList: { mac: string }[] };
        this.devices.forEach(d => { d.blocked = Boolean(v.macFilterEn && v.blackList.some(b => b.mac.toUpperCase() === d.mac)); });
      } else if (!['systemReboot', 'systemReset', 'meshOptimize', 'addNode', 'agentLocalUpgrade', 'systemPwd'].includes(module)) this.data[module] = clone(value);
    }
    return { errCode: 0 };
  }
  async overview(): Promise<Overview> { this.check(); const wave = Math.sin((Date.now() - this.start) / 6000); const wifi = this.data.wifiBasicCfg as Record<string, unknown> | undefined; return { internet: true, wanIp: '192.0.2.42', connectionType: 'PPPoE', upload: Math.round(1300000 + wave * 400000), download: Math.round(9400000 + wave * 3100000), uptime: 86400 * 3 + Math.floor((Date.now() - this.start) / 1000), clientCount: this.devices.filter(d => d.online).length, nodeCount: nodes.length, wifiNames: ['', '_5g', '_6g'].map(suffix => String(wifi?.[`wifiSSID${suffix}`] || 'Casa conectada')), nodes: await this.mesh(), sampledAt: new Date().toISOString(), model: 'RX27 Pro', firmware: this.getConnection().firmware, mode: 'router' }; }
  async clients(): Promise<ClientDevice[]> { this.check(); return clone(this.devices); }
  async mesh(): Promise<MeshNode[]> { this.check(); return clone(nodes).map(n => ({ ...n, clients: this.devices.filter(d => d.online && d.nodeId === n.id).length })); }
  async scanMesh(): Promise<Record<string, unknown>> { this.check(); this.writes.push('scanMesh'); this.data.scanNodeList = [{ sn: 'DEMO-NOVO-1234', nodeName: 'Novo nó (demonstração)' }]; return { scanNodeList: [] }; }
  async readScanResults(): Promise<Record<string, unknown>> { return this.readModules(['scanNodeList']); }
  async downloadConfig(): Promise<Buffer> { this.check(); return Buffer.from('TENDA-DEMO-CONFIGURATION\nSomente dados sintéticos de demonstração.\n'); }
  async upload(kind: 'firmware' | 'configuration', _bytes: Buffer, _filename: string, _fields?: Record<string, string>): Promise<Record<string, unknown>> { this.check(); this.writes.push(`upload:${kind}`); return { error: 0, errCode: 0 }; }
}

import { describe, expect, it } from 'vitest';
import { decryptPayload, encryptPayload, normalizeClients, normalizeMesh, normalizeOverview, parseUploadResponse, passwordDigest, RouterClient, RouterError, validateJSONTree, validateRouterHost, type RouterRequest, type RouterResponse, type RouterTransport } from './index';
import type { ConnectionStatus } from '../../shared/types';

const firstSign = '0123456789abcdef0123456789abcdef';
const rotatedSign = 'fedcba9876543210fedcba9876543210';
const data: Record<string, unknown> = {
  systemCfg: { productName: 'RX27_PRO', softVersion: 'V16.03.28.20_multi', hardVersion: 'V1.0', runTime: 1200 },
  workMode: { workMode: 'router' }, localhost: { mac: 'AA:BB:CC:DD:EE:01' },
  wanStatus: { connectCode: 1, wanUpSpeed: 128, wanDownSpeed: '256', wanIP: '100.64.0.2', wanType: 'pppoe' },
  wifiBasicCfg: { tripleBand: true, wifiEn: true, wifiEn_5g: true, wifiEn_6g: true, wifiSSID: 'Minha rede', wifiSSID_5g: 'Minha rede', wifiSSID_6g: 'Minha rede', wifiPwd: 'synthetic-secret' },
  meshTopo: { sn: 'PRIMARY', nodeName: 'RX27 Pro', nodeType: 'controller', ip: '192.168.0.1', clientNum: 1,
    childNode: [{ sn: 'SECOND', nodeName: 'Escritório', connectStatus: 'normal', connectType: '5G', clientNum: 1, childNode: [] }] },
  deviceList: [{ sn: 'PRIMARY', nodeName: 'RX27 Pro', onlineList: [{ hostname: '<img src=x onerror=alert(1)>', mac: 'AA:BB:CC:DD:EE:01', ip: '192.168.0.2', connectType: 'wire', upSpeed: '64', downSpeed: 128, controlEn: true, upLimit: '128', downLimit: '0', connectTime: 90 }], guestList: [], offlineList: [] },
    { sn: 'SECOND', nodeName: 'Escritório', onlineList: [], guestList: [{ hostname: 'Celular', mac: 'AA:BB:CC:DD:EE:02', ip: '192.168.0.3', connectType: '5G' }], offlineList: [{ hostname: 'Offline', mac: 'AA:BB:CC:DD:EE:03' }] }],
  macFilter: { macFilterEn: true, curFilterMode: 'deny', blackList: [{ hostname: 'Bloqueado', mac: 'AA:BB:CC:DD:EE:04' }] },
  deviceVersionList: [{ sn: 'PRIMARY', nodeType: 'controller' }, { sn: 'SECOND', nodeType: 'agent' }],
};

const jsonReply = (value: unknown): RouterResponse => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
const encryptedReply = (value: unknown, sign = rotatedSign): RouterResponse => jsonReply({ data: encryptPayload(value, sign) });
function fakeTransport(override?: (request: RouterRequest) => RouterResponse | Promise<RouterResponse | undefined> | undefined) {
  const requests: RouterRequest[] = [];
  const transport: RouterTransport = async request => {
    requests.push(request);
    const special = override ? await override(request) : undefined;
    if (special) return special;
    if (request.path.startsWith('/goform/loginInfo')) return { ...jsonReply({ loginInfo: { isLimit: false, isLocked: false, leftTimes: 5 } }), headers: { 'set-cookie': ['SID=synthetic; Path=/; HttpOnly'] } };
    if (request.path === '/login/Auth') return jsonReply({ errCode: 0, sign: firstSign, stok: 'FIRST_TOKEN' });
    if (request.path.startsWith('/goform/stokCfg?')) return jsonReply({ stokCfg: { sign: rotatedSign, stok: 'ROTATED_TOKEN' } });
    if (request.path === '/js/macro_config.js') return { status: 200, headers: {}, body: Buffer.from('var CONFIG_PRODUCT="RX27_PRO";var CONFIG_WIFI_2_4G="y";var CONFIG_WIFI_5G="y";var CONFIG_WIFI_SUPPORT_6G="y";var CONFIG_MESH_SUPPORT="y";') };
    if (request.path.includes('/goform/getModules')) {
      const modules = new URL(`http://192.168.0.1${request.path}`).searchParams.get('modules')!.split(',');
      const reply: Record<string, unknown> = { errCode: 0 };
      for (const module of modules) { const key = module === 'deviceListNotNeedRate' ? 'deviceList' : module; reply[key] = data[key] ?? {}; }
      return encryptedReply(reply);
    }
    if (request.path.includes('/goform/setModules')) return encryptedReply({ errCode: 0 });
    if (request.path === '/cgi-bin/DownloadCfg/RouterCfm.cfg') return { status: 200, headers: {}, body: Buffer.from('synthetic configuration') };
    if (request.path.startsWith('/cgi-bin/')) return jsonReply({ error: 0 });
    throw new Error('Unexpected synthetic request');
  };
  return { transport, requests };
}
async function connected(override?: Parameters<typeof fakeTransport>[0]) {
  const fake = fakeTransport(override);
  const client = new RouterClient({ transport: fake.transport, minIntervalMs: 0 });
  await client.connect('192.168.0.1', 'admin');
  return { client, ...fake };
}

describe('legacy protocol compatibility', () => {
  it('matches the observed uppercase MD5 and a fixed AES-CBC fixture', () => {
    expect(passwordDigest('admin')).toBe('21232F297A57A5A743894A0E4A801FC3');
    const ciphertext = '4JJwZlWWmt3TpfVIzaQYslSDDw4fD2lrcslDMbNLKF8=';
    expect(encryptPayload({ modules: 'wanStatus' }, firstSign)).toBe(ciphertext);
    expect(decryptPayload(ciphertext, firstSign)).toBe('{"modules":"wanStatus"}');
    expect(() => decryptPayload('invalid base64', firstSign)).toThrow();
    expect(() => decryptPayload(ciphertext, 'wrong')).toThrow();
  });

  it('authenticates once, refreshes keys, carries cookies and sends encrypted writes', async () => {
    const { client, requests } = await connected();
    const login = requests.find(request => request.path === '/login/Auth')!;
    expect(JSON.parse(login.body!.toString())).toEqual({ userName: 'admin', password: passwordDigest('admin') });
    expect(login.headers.Cookie).toBe('SID=synthetic');
    expect(login.headers.Referer).toBe('http://192.168.0.1/login.html');
    const bootstrap = requests.find(request => request.path.startsWith('/goform/stokCfg?'))!;
    expect(bootstrap).toBeDefined();
    expect(bootstrap.path).not.toContain(';stok=');
    expect(bootstrap.headers.Cookie).toBe('SID=synthetic');
    expect(client.getConnection()).toMatchObject({ connected: true, model: 'RX27 PRO', firmware: 'V16.03.28.20_multi', capabilities: ['wifi24', 'wifi5', 'wifi6', 'mesh'] });
    await client.writeModules({ ledCfg: { ledType: 'enable' } });
    const write = requests.at(-1)!;
    expect(write.path).toContain('/;stok=ROTATED_TOKEN/goform/setModules');
    expect(decryptPayload(JSON.parse(write.body!.toString()).data, rotatedSign)).toBe('{"ledCfg":{"ledType":"enable"}}');
    expect(write.body!.toString()).not.toContain('ledType');
  });

  it('honors server lockout without attempting a password', async () => {
    const fake = fakeTransport(request => request.path.startsWith('/goform/loginInfo') ? jsonReply({ loginInfo: { isLimit: false, isLocked: true, time: 120 } }) : undefined);
    const client = new RouterClient({ transport: fake.transport, minIntervalMs: 0 });
    await expect(client.connect('192.168.0.1', 'admin')).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(client.connect('192.168.0.1', 'admin')).rejects.toMatchObject({ code: 'LOCKED' });
    expect(fake.requests).toHaveLength(1);
  });
  it.each([100,102])('preserves the documented state-transition acknowledgment %s',async code=>{
    const {client}=await connected(request=>request.path.includes('/goform/setModules')?encryptedReply({errCode:code}):undefined);
    await expect(client.writeModules(code===100?{systemReboot:{action:'reboot'}}:{systemReset:{action:'reset'}})).resolves.toMatchObject({errCode:code});
  });
  it('carries the exact nonstandard username cookie emitted by this firmware', async () => {
    const fake = fakeTransport(request => request.path === '/login/Auth' ? { ...jsonReply({errCode:0,sign:firstSign,stok:'FIRST_TOKEN'}), headers:{'set-cookie':['_:USERNAME:_=synthetic-admin; Path=/; HttpOnly']} } : undefined);
    const client = new RouterClient({transport:fake.transport,minIntervalMs:0});
    await client.connect('192.168.0.1','synthetic');
    const bootstrap=fake.requests.find(r=>r.path.startsWith('/goform/stokCfg?'))!;
    const modules=fake.requests.find(r=>r.path.includes('/goform/getModules'))!;
    expect(bootstrap.headers.Cookie).toContain('_:USERNAME:_=synthetic-admin');
    expect(modules.headers.Cookie).toContain('_:USERNAME:_=synthetic-admin');
  });
  it('identifies the failed login stage without exposing credentials or session tokens', async () => {
    const fake = fakeTransport(request => request.path.includes('/goform/stokCfg') ? {status:500,headers:{},body:Buffer.from('error')} : undefined);
    const client = new RouterClient({ transport: fake.transport, minIntervalMs: 0 });
    const error = await client.connect('192.168.0.1','synthetic-private-password').then(() => { throw new Error('Expected failure'); }, (error: unknown) => { if (!(error instanceof RouterError)) throw error; return error; });
    expect(error).toMatchObject({code:'ROUTER'});
    expect(error.message).toContain('validar a sessão');
    expect(error.message).toContain('HTTP 500');
    expect(error.message).not.toContain('synthetic-private-password');
    expect(error.message).not.toContain(firstSign);
    expect(error.message).not.toContain('FIRST_TOKEN');
  });
});

describe('request boundaries and session lifecycle', () => {
  it('retries a transient read failure once without repeating a command',async()=>{
    let fail=false,attempts=0;
    const {client}=await connected(request=>{if(fail&&request.path.includes('/goform/getModules')){attempts++;if(attempts===1)throw new RouterError('OFFLINE','Synthetic reset');}return undefined;});
    fail=true;await expect(client.mesh()).resolves.toHaveLength(2);expect(attempts).toBe(2);
  });
  it.each(['127.0.0.1', '8.8.8.8', 'tendawifi.com', 'http://192.168.0.1', '192.168.0.1:80', '192.168.000.1', '10.0.0.255', '169.254.1.1', '2130706433'])('rejects non-canonical private destination %s', host => {
    expect(() => validateRouterHost(host)).toThrow(RouterError);
  });
  it.each(['10.0.0.1', '172.16.0.1', '172.31.255.2', '192.168.0.1'])('accepts a literal private destination %s', host => {
    expect(validateRouterHost(host)).toBe(host);
  });
  it('rejects action GETs and arbitrary parameters through the read-only API', async () => {
    const { client, requests } = await connected(); const before = requests.length;
    await expect(client.readModules(['CLEAR_MODULE'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.readModules(['scanNodeList'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.readModules(['syschkInfo'], { action: 'scan' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.writeModules({ unexpected: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(requests).toHaveLength(before);
  });
  it('rejects prototypes, excessive depth and non-JSON values', () => {
    expect(() => validateJSONTree(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow();
    expect(() => validateJSONTree({ constructor: {} })).toThrow();
    expect(() => validateJSONTree({ x: new Date() })).toThrow();
    expect(() => validateJSONTree({ x: NaN })).toThrow();
    let deep: unknown = 0; for (let index = 0; index < 30; index++) deep = [deep];
    expect(() => validateJSONTree(deep)).toThrow();
  });
  it('clears the session on redirected or expired module responses', async () => {
    let expire = false;
    const { client, requests } = await connected(request => expire && request.path.includes('/goform/getModules') ? { status: 302, headers: { location: 'http://untrusted.invalid/' }, body: Buffer.alloc(0) } : undefined);
    expire = true;
    await expect(client.clients()).rejects.toMatchObject({ code: 'AUTH' });
    expect(client.getConnection().connected).toBe(false);
    expect(requests.some(request => request.host !== '192.168.0.1')).toBe(false);
  });
  it('does not silently accept plaintext authenticated module responses', async () => {
    let invalid = false;
    const { client } = await connected(request => invalid && request.path.includes('/goform/getModules') ? jsonReply({ errCode: 0, deviceList: [] }) : undefined);
    invalid = true;
    await expect(client.clients()).rejects.toMatchObject({ code: 'ROUTER' });
  });
  it('fails closed when an authenticated module is missing', async () => {
    let omit = false;
    const { client } = await connected(request => omit && request.path.includes('/goform/getModules') ? encryptedReply({ errCode: 0 }) : undefined);
    omit = true;
    await expect(client.clients()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
  it('rejects explicit session expiry and does not transmit later calls', async () => {
    let expire = false;
    const { client, requests } = await connected(request => expire && request.path.includes('/goform/getModules') ? jsonReply({ errCode: 1000 }) : undefined);
    expire = true;
    await expect(client.clients()).rejects.toMatchObject({ code: 'AUTH' });
    const before = requests.length;
    await expect(client.mesh()).rejects.toMatchObject({ code: 'AUTH' });
    expect(requests).toHaveLength(before);
  });
  it('does not retry a mutation after an uncertain timeout', async () => {
    const { client, requests } = await connected(request => {
      if (request.path.includes('/goform/setModules')) throw new RouterError('UNCERTAIN', 'Synthetic timeout');
      return undefined;
    });
    await expect(client.writeModules({ systemReboot: { action: 'reboot' } })).rejects.toMatchObject({ code: 'UNCERTAIN' });
    expect(requests.filter(request => request.path.includes('/goform/setModules'))).toHaveLength(1);
  });
  it('serializes requests and refuses calls after disconnect', async () => {
    let active = 0, highest = 0;
    const { client } = await connected(async request => {
      if (request.path.includes('/goform/getModules')) { active++; highest = Math.max(highest, active); await new Promise(resolve => setTimeout(resolve, 3)); active--; }
      return undefined;
    });
    await Promise.all([client.clients(), client.mesh(), client.overview()]);
    expect(highest).toBe(1);
    await client.disconnect();
    await expect(client.clients()).rejects.toMatchObject({ code: 'AUTH' });
    await expect(client.writeModules({ ledCfg: { ledType: 'enable' } })).rejects.toMatchObject({ code: 'AUTH' });
  });
});

describe('wire response normalization', () => {
  const connection: ConnectionStatus = { connected: true, demo: false, host: '192.168.0.1', model: 'RX27 PRO', firmware: 'V16.03.28.20_multi', hardware: 'V1.0', mode: 'router', capabilities: [] };
  it('flattens topology with parent identity and signal quality', () => {
    expect(normalizeMesh(data)).toMatchObject([{ id: 'PRIMARY', parentId: null, clients: 1, primary: true }, { id: 'SECOND', parentId: 'PRIMARY', quality: 'normal', primary: false }]);
  });
  it('keeps strings inert, converts KB/s and recognizes guest/offline/blocked/local clients', () => {
    const clients = normalizeClients(data);
    expect(clients).toHaveLength(4);
    expect(clients[0]).toMatchObject({ name: '<img src=x onerror=alert(1)>', local: true, upload: 65536, download: 131072, uploadLimit: 128, downloadLimit: 0, uptime: 90 });
    expect(clients[1].guest).toBe(true);
    expect(clients[2].online).toBe(false);
    expect(clients[3].blocked).toBe(true);
    expect(JSON.stringify(clients)).not.toContain('synthetic-secret');
  });
  it('normalizes overview without returning Wi-Fi credentials', () => {
    const overview = normalizeOverview(data, connection);
    expect(overview).toMatchObject({ internet: true, upload: 131072, download: 262144, clientCount: 2, nodeCount: 2, wifiNames: ['Minha rede', 'Minha rede', 'Minha rede'], uptime: 1200 });
    expect(JSON.stringify(overview)).not.toContain('synthetic-secret');
  });
});

describe('bounded file transfer', () => {
  it('downloads config as bytes and uploads with a fixed safe multipart filename', async () => {
    const { client, requests } = await connected();
    expect((await client.downloadConfig()).toString()).toBe('synthetic configuration');
    const firmware = Buffer.alloc(36, 7); firmware.writeUInt32BE(32, 0);
    await client.upload('firmware', firmware, 'original.bin', { sn: 'PRIMARY' });
    const upload = requests.at(-1)!;
    expect(upload.path).toBe('/cgi-bin/upgrade');
    expect(upload.body!.toString()).toContain('name="file"; filename="firmware.bin"');
    expect(upload.body!.toString()).toContain('name="sn"');
    expect(upload.body!.toString()).not.toContain('original.bin');
    await expect(client.upload('configuration', Buffer.from('x'), 'backup.cfg', { sn: 'PRIMARY' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('rejects unsupported firmware framing before transmitting anything', async () => {
    const { client, requests } = await connected(); const before = requests.length;
    await expect(client.upload('firmware', Buffer.alloc(32), 'firmware.bin')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(requests).toHaveLength(before);
  });
  it('parses only JSON or constrained iframe carriers without evaluating scripts', () => {
    expect(parseUploadResponse(Buffer.from('{"error":0}'))).toEqual({ error: 0 });
    expect(parseUploadResponse(Buffer.from('<script>window.parent.postMessage({"error":0}, "*");</script>'))).toEqual({ error: 0 });
    expect(() => parseUploadResponse(Buffer.from('<script>globalThis.compromised=true;parent.postMessage({"error":0}, "*");</script>'))).toThrow();
    expect(() => parseUploadResponse(Buffer.from('{"message":"maybe"}'))).toThrow();
  });
});

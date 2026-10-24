import type { ClientDevice, MeshNode, Overview, ConnectionStatus } from '../../shared/types';

export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, 4096) : [];
export const text = (value: unknown, fallback = '', max = 256): string => typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
export const number = (value: unknown, fallback = 0): number => {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return fallback;
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
};
export const enabled = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true' || value === 'enable' || value === 'on';

export function normalizeMesh(data: Record<string, unknown>): MeshNode[] {
  const nodes: MeshNode[] = [];
  const seen = new Set<string>();
  const deviceNodes = list(data.deviceList).map(record);
  const versions = list(data.deviceVersionList).map(record);
  const walk = (raw: unknown, parentId: string | null, depth: number) => {
    if (depth > 32 || nodes.length >= 256) return;
    const node = record(raw);
    const id = text(node.sn, text(node.mac, text(node.ip)));
    if (!id || seen.has(id)) return;
    seen.add(id);
    const device = deviceNodes.find(item => item.sn === node.sn) ?? {};
    const version = versions.find(item => item.sn === node.sn) ?? {};
    const connectType = text(node.connectType, text(device.connectType));
    const primary = parentId === null || node.nodeType === 'controller';
    nodes.push({
      id, name: text(node.nodeName, text(node.hostname, 'Roteador')), model: text(node.productName, text(node.model, text(version.productName))),
      ip: text(node.ip, text(device.ip)), parentId, online: connectType !== 'offline' && node.connectStatus !== 'offline', primary,
      clients: number(node.clientNum, list(device.onlineList).length + list(device.guestList).length),
      quality: connectType === 'wire' || primary ? 'good' : text(node.connectStatus, 'unknown'),
      band: connectType === 'wire' ? 'Ethernet' : connectType,
    });
    for (const child of list(node.childNode)) walk(child, id, depth + 1);
  };
  const roots = Array.isArray(data.meshTopo) ? data.meshTopo : [data.meshTopo];
  for (const root of roots) walk(root, null, 0);
  // deviceList also includes disconnected nodes which are absent from some topology replies.
  for (const raw of deviceNodes) {
    const id = text(raw.sn);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, name: text(raw.nodeName, 'Roteador'), model: text(raw.productName), ip: text(raw.ip), parentId: nodes[0]?.id ?? null,
      online: raw.connectType !== 'offline', primary: raw.nodeType === 'controller' || nodes.length === 0,
      clients: list(raw.onlineList).length + list(raw.guestList).length, quality: 'unknown', band: text(raw.connectType), });
  }
  return nodes;
}

export function normalizeClients(data: Record<string, unknown>): ClientDevice[] {
  const result: ClientDevice[] = [];
  const local = text(record(data.localhost).mac).toUpperCase();
  const filter = record(data.macFilter);
  const blocked = new Set(enabled(filter.macFilterEn) && filter.curFilterMode === 'deny' ? list(filter.blackList).map(row => text(record(row).mac).toUpperCase()) : []);
  const seen = new Set<string>();
  const add = (raw: unknown, node: Record<string, unknown>, online: boolean, guest: boolean) => {
    if (result.length >= 4096) return;
    const client = record(raw);
    const mac = text(client.mac).toUpperCase();
    if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) return;
    const nodeId = text(node.sn);
    const id = `${nodeId}:${mac}`;
    if (seen.has(id)) return;
    seen.add(id);
    const limited = enabled(client.controlEn);
    result.push({ id, mac, name: text(client.hostname, 'Dispositivo'), ip: text(client.ip), nodeId, nodeName: text(node.nodeName),
      online, guest, blocked: blocked.has(mac), local: mac === local,
      connection: text(client.connectType, online ? 'wire' : 'offline'),
      upload: number(client.upSpeed) * 1024, download: number(client.downSpeed) * 1024,
      uploadLimit: limited ? number(client.upLimit) : 0, downloadLimit: limited ? number(client.downLimit) : 0,
      uptime: number(client.connectTime), });
  };
  for (const rawNode of list(data.deviceList)) {
    const node = record(rawNode);
    for (const item of list(node.onlineList)) add(item, node, true, false);
    for (const item of list(node.guestList)) add(item, node, true, true);
    for (const item of list(node.offlineList)) add(item, node, false, false);
  }
  for (const raw of list(filter.blackList)) {
    const client = record(raw);
    const mac = text(client.mac).toUpperCase();
    if (!result.some(item => item.mac === mac)) add(client, {}, false, false);
  }
  return result;
}

export function normalizeOverview(data: Record<string, unknown>, connection: ConnectionStatus): Overview {
  const wan = record(data.wanStatus);
  const system = record(data.systemCfg);
  const wifi = record(data.wifiBasicCfg);
  const mode = text(record(data.workMode).workMode, connection.mode);
  const nodes = normalizeMesh(data);
  const clients = normalizeClients(data);
  // Positions are stable: 2.4 GHz, 5 GHz, 6 GHz. Empty means absent or disabled.
  const wifiNames: string[] = ['', '', ''];
  for (const [index, suffix] of ['', '_5g', '_6g'].entries()) {
    if (enabled(wifi[`wifiCurStatus${suffix}`]) || enabled(wifi[`wifiEn${suffix}`])) {
      const ssid = text(wifi[`wifiSSID${suffix}`], '', 128);
      wifiNames[index] = ssid;
    }
  }
  const ap = record(data.apModeStatus);
  return { internet: mode === 'ap' ? enabled(ap.isInternet) : number(wan.connectCode) === 1,
    wanIp: text(wan.wanIP), connectionType: text(wan.wanType, text(record(data.wanCfg).wanType)),
    upload: number(wan.wanUpSpeed) * 1024, download: number(wan.wanDownSpeed) * 1024,
    uptime: number(system.runTime), clientCount: clients.filter(item => item.online).length, nodeCount: nodes.length,
    wifiNames, nodes, sampledAt: new Date().toISOString(), model: text(system.productName, connection.model),
    firmware: text(system.softVersion, connection.firmware), mode };
}

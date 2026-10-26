import type { ClientDevice, MeshNode } from '../../shared/types';

const numbers = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const names = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
export const meshNumber = (value: number) => numbers.format(value);
export function meshRate(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const bits = bytes * 8;
  return `${numbers.format(bits >= 1e9 ? bits / 1e9 : bits >= 1e6 ? bits / 1e6 : bits / 1e3)} ${bits >= 1e9 ? 'Gbps' : bits >= 1e6 ? 'Mbps' : 'Kbps'}`;
}
export function connectionLabel(value: string | null | undefined) {
  if (!value?.trim() || value === 'offline') return 'Não informado';
  return ({ wire: 'Ethernet', wired: 'Ethernet', Ethernet: 'Ethernet', '2.4G': '2,4 GHz', '2.4 GHz': '2,4 GHz', '5G': '5 GHz', '6G': '6 GHz', wifi: 'Wi-Fi' } as Record<string, string>)[value] ?? value;
}
export function radioValue(value: string | null | undefined, bandwidth = false, configured = false) {
  if (!value?.trim()) return 'Não informado';
  if (value === 'auto' || value === '0') return configured ? (bandwidth ? 'Automática' : 'Automático') : 'Não informado';
  return bandwidth && /^\d+(?:\/\d+)*$/.test(value) ? `${value} MHz` : value;
}
export function nodeQuality(node: MeshNode) {
  if (node.primary) return { label: 'Não se aplica', tone: 'muted', note: 'O controlador principal não possui enlace de backhaul com outro nó.' };
  if (connectionLabel(node.band) === 'Ethernet') return { label: 'A cabo', tone: 'muted', note: 'Conexão Ethernet; não representa uma medição de qualidade do enlace.' };
  if (!node.online) return { label: 'Offline', tone: 'muted', note: 'Nó informado como offline na última topologia.' };
  const known: Record<string, [string, string]> = { good: ['Boa', 'good'], normal: ['Boa', 'good'], medium: ['Razoável', 'warning'], weak: ['Fraca', 'warning'], bad: ['Fraca', 'warning'] };
  const quality = known[node.quality];
  return quality ? { label: quality[0], tone: quality[1], note: 'Classificação fornecida pelo firmware, sem velocidade medida do backhaul.' }
    : { label: 'Não informada', tone: 'muted', note: 'O firmware não disponibilizou uma classificação interpretada para este enlace.' };
}
export function parentName(node: MeshNode, nodes: MeshNode[]) {
  if (node.primary) return 'Internet / WAN';
  return nodes.find(candidate => candidate.id === node.parentId)?.name ?? 'Não informado';
}
function total(clients: ClientDevice[], direction: 'upload' | 'download'): number | null {
  return clients.every(client => Number.isFinite(client[direction]) && client[direction] >= 0) ? clients.reduce((sum, client) => sum + client[direction], 0) : null;
}
export interface MeshRow { node: MeshNode; clients: ClientDevice[]; upload: number | null; download: number | null }
export function meshView(nodes: MeshNode[], clients: ClientDevice[]) {
  const known = new Set(nodes.map(node => node.id)), unique = new Map<string, ClientDevice>(), ambiguous = new Set<string>(), unassigned = new Set<string>();
  for (const client of clients) {
    if (!client.online) continue;
    const previous = unique.get(client.mac);
    if (client.ambiguous || previous && previous.nodeId !== client.nodeId) ambiguous.add(client.mac);
    if (!previous) unique.set(client.mac, client);
  }
  const associated = new Map<string, ClientDevice[]>();
  for (const client of unique.values()) {
    if (ambiguous.has(client.mac)) continue;
    if (!known.has(client.nodeId)) { unassigned.add(client.mac); continue; }
    const group = associated.get(client.nodeId) ?? []; group.push(client); associated.set(client.nodeId, group);
  }
  const rows: MeshRow[] = [...nodes].sort((a, b) => Number(b.primary) - Number(a.primary) || names.compare(a.name, b.name) || a.id.localeCompare(b.id)).map(node => {
    const group = associated.get(node.id) ?? [];
    return { node, clients: group, download: total(group, 'download'), upload: total(group, 'upload') };
  });
  const included = rows.flatMap(row => row.clients);
  return { rows, clients: included.length, online: nodes.filter(node => node.online).length, download: total(included, 'download'), upload: total(included, 'upload'), ambiguous: ambiguous.size, unassigned: unassigned.size };
}
export type MeshClientSort = 'name' | 'download' | 'upload';
export function filterMeshClients(clients: ClientDevice[], search: string, connection: string, sort: MeshClientSort) {
  const term = search.trim().toLocaleLowerCase('pt-BR');
  return clients.filter(client => (!term || `${client.name} ${client.ip} ${client.mac}`.toLocaleLowerCase('pt-BR').includes(term)) && (connection === 'all' || connectionLabel(client.connection) === connection)).sort((a, b) => (sort === 'name' ? 0 : (b[sort] ?? 0) - (a[sort] ?? 0)) || names.compare(a.name, b.name) || a.mac.localeCompare(b.mac));
}

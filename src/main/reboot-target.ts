import { z } from 'zod';
import type { MeshNode } from '../shared/types';
import type { ManagedRouter } from './service';
import { AppError } from './errors';
import { validateRouterHost } from './router/transport';

export interface RebootTarget { id: string; primary: boolean; mac: string; ip: string | null }
const identifier = z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/);
const address = z.string().regex(/^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/).transform(value => value.toUpperCase()).refine(value => value !== '00:00:00:00:00:00' && (parseInt(value.slice(0, 2), 16) & 1) === 0);
const identity = z.strictObject({ sn: identifier, mac: address, nodeType: z.enum(['controller', 'agent']) });

/** meshInfo + sn is the vendor's node-detail read. No per-node HTTP connection is created. */
export async function resolveRebootTarget(router: ManagedRouter, node: MeshNode): Promise<RebootTarget> {
  if (!identifier.safeParse(node.id).success) throw new AppError('UNSUPPORTED', 'O firmware não informou uma identificação válida para reiniciar este nó.');
  const data = await router.readModules(['meshInfo'], { sn: node.id });
  const info = data.meshInfo !== null && typeof data.meshInfo === 'object' && !Array.isArray(data.meshInfo) ? data.meshInfo as Record<string, unknown> : {};
  if (info.sn !== node.id) throw new AppError('FORBIDDEN', 'O firmware não confirmou a identidade do nó selecionado. Atualize a topologia e revise novamente.');
  const parsed = identity.safeParse({ sn: info.sn, mac: info.mac, nodeType: info.nodeType });
  if (!parsed.success) throw new AppError('UNSUPPORTED', 'O firmware não disponibilizou identificação e MAC válidos para reiniciar este nó.');
  const primary = parsed.data.nodeType === 'controller';
  if (primary !== node.primary) throw new AppError('CONFLICT', 'O papel do nó mudou. Atualize a topologia e revise a reinicialização novamente.');
  let ip: string | null = null;
  if (!primary) {
    try { ip = validateRouterHost(info.ip as string); }
    catch { throw new AppError('UNSUPPORTED', 'O firmware não disponibilizou um IP privado válido para reiniciar este nó.'); }
  }
  return { id: parsed.data.sn, primary, mac: parsed.data.mac, ip };
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RESOURCE_INTERVAL_MS, RESOURCE_STALE_MS, type DiagnosticStatus, type ResourceReading, type ResourceSample } from '../../shared/monitoring';
import { AppError } from '../errors';

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = z.string().max(64);
const rowSchema = z.object({ item_name: text, item_status: text.optional(), result: text.optional(), details: z.unknown().optional() });
const responseSchema = z.object({ check_type: z.enum(['', '--', 'init', 'unchecked', 'checking', 'checked', 'optimizing', 'optimized']).optional(), progress_rate: z.union([z.number(), z.string().max(12)]).optional(), data: z.array(rowSchema).max(32).optional() });
export function diagnosticPercent(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d{1,3}(?:\.\d{1,3})?%?$/.test(value)) return null;
  const n = Number(String(value).replace('%', ''));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
export function parseDiagnostic(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new AppError('ROUTER', 'Resposta de diagnóstico inválida.');
  const row = parsed.data.data?.find(r => r.item_name === 'run_status'), details = record(row?.details);
  return { knownState: parsed.data.check_type !== undefined, type: parsed.data.check_type ?? '', progress: diagnosticPercent(parsed.data.progress_rate), cpu: diagnosticPercent(details.cpu_rate), memory: diagnosticPercent(details.mem_rate), valid: !!row && ['checked', 'unoptimize', 'optimized'].includes(row.item_status ?? '') && ['normal', 'unormal'].includes(row.result ?? '') };
}
export interface DiagnosticIO { read(): Promise<unknown>; write(action: 'init' | 'start' | 'stop'): Promise<void> }
const busy = (type: string) => type === 'checking' || type === 'optimizing';

/** Active checks only. There is intentionally no optimize operation or arbitrary module API. */
export class ResourceDiagnostics {
  private enabled = false; private blocked = 0; private generation = 0; private invalidation = 0;
  private timer?: ReturnType<typeof setTimeout>; private task?: Promise<void>;
  private owned = false; private uncertain = false; private startedAt = 0; private sawChecking = false;
  private nextAllowedAt = 0;
  private nodeId = ''; private last?: ResourceReading; private sample?: ResourceSample;
  private status: DiagnosticStatus = { status: 'disabled', progress: null, nextAt: null, message: 'Diagnóstico automático desativado.' };
  constructor(private io: DiagnosticIO, private now = () => Date.now()) {}
  snapshot() { return structuredClone(this.status); }
  reading(): ResourceReading[] { const age = this.last?.sampledAt == null ? -1 : this.now()-this.last.sampledAt; return this.last ? [{ ...this.last, current: this.last.current && age >= 0 && age <= RESOURCE_STALE_MS }] : []; }
  latestSample() { return this.sample ? { ...this.sample } : undefined; }
  unavailable() { this.invalidate(); this.status = { status: 'unavailable', progress: null, nextAt: null, message: 'Diagnóstico automático indisponível para este equipamento ou estado.' }; }
  passive(value: unknown, nodeId: string) {
    if (this.last?.sampledAt !== null && this.last?.sampledAt !== undefined || this.owned || this.task) return;
    const p = parseDiagnostic(value);
    this.last = { nodeId, cpu: p.cpu, memory: p.memory, source: 'diagnostic', sampledAt: null, current: false };
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(delay: number) {
    this.clearTimer(); if (!this.enabled || this.blocked) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.poll(); }, delay);
    this.timer.unref?.();
  }
  private waiting(message: string, fullDelay = true) { if (fullDelay) this.nextAllowedAt = this.now() + RESOURCE_INTERVAL_MS; const delay = Math.max(0,this.nextAllowedAt-this.now()); this.status = { status: 'waiting', progress: null, nextAt: this.now()+delay, message }; this.schedule(delay); }
  async configure(enabled: boolean, nodeId: string) {
    this.nodeId = nodeId;
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) { const delay = Math.max(0,this.nextAllowedAt-this.now()); this.status = { status: 'waiting', progress: null, nextAt: this.now()+delay, message: 'Aguardando diagnóstico automático.' }; this.schedule(delay); }
    else { this.generation++; this.clearTimer(); await this.task; await this.cancelOwned(); this.status = { status: this.uncertain ? 'uncertain' : 'disabled', progress: null, nextAt: null, message: this.uncertain ? 'Estado do diagnóstico pendente de verificação.' : 'Diagnóstico automático desativado.' }; }
  }
  /** Synchronous invalidation for sleep/session boundaries. Never claim a late result as a new sample. */
  invalidate(clear = false) {
    this.enabled = false; this.generation++; this.invalidation++; this.clearTimer(); this.uncertain ||= this.owned; this.owned = false; this.sawChecking = false;
    if (this.last) this.last.current = false;
    if (clear) { this.last = undefined; this.sample = undefined; this.uncertain = false; this.nextAllowedAt = 0; }
    this.status = { status: 'disabled', progress: null, nextAt: null, message: 'Coleta de recursos interrompida.' };
  }
  async maintenance(): Promise<() => void> {
    this.blocked++; this.generation++; this.clearTimer();
    try { await this.task; await this.cancelOwned(); if (this.uncertain) throw new AppError('UNCERTAIN', 'Não foi possível confirmar o encerramento do diagnóstico. Aguarde antes de alterar o roteador.'); }
    catch (error) { this.blocked--; this.schedule(RESOURCE_INTERVAL_MS); throw error; }
    return () => { this.blocked--; if (this.enabled) this.waiting('Próximo diagnóstico após a manutenção.'); };
  }
  private async cancelOwned() {
    if (!this.owned) {
      if (this.uncertain) { try { this.uncertain = busy(parseDiagnostic(await this.io.read()).type); } catch { /* Uncertainty cannot authorize another write. */ } }
      return;
    }
    try {
      const p = parseDiagnostic(await this.io.read());
      if (p.type === 'checking') {
        await this.io.write('stop'); const after = parseDiagnostic(await this.io.read());
        if (busy(after.type)) throw new AppError('UNCERTAIN', 'O diagnóstico ainda está em andamento.');
      }
      // A different operation is never cancelled, even when it replaced our check.
      this.owned = false; this.uncertain = p.type === 'optimizing'; this.sawChecking = false;
    } catch { this.owned = false; this.uncertain = true; }
  }
  private poll(): Promise<void> {
    if (this.task || !this.enabled || this.blocked) return Promise.resolve();
    const generation = this.generation, invalidation = this.invalidation;
    const current = () => generation === this.generation && this.enabled && !this.blocked;
    const work = async () => {
      try {
        const p = parseDiagnostic(await this.io.read()); if (!current()) return;
        if (!p.knownState) throw new AppError('UNSUPPORTED','Diagnostic state unavailable.');
        if (this.uncertain) {
          if (this.owned && this.now() - this.startedAt >= 120000) { await this.cancelOwned(); if (current()) this.waiting('Ciclo encerrado sem medição confirmada.'); }
          else if (busy(p.type)) { this.status = { status: 'uncertain', progress: p.progress, nextAt: null, message: 'Aguardando encerrar uma operação de resultado incerto; não será repetida.' }; this.schedule(2000); }
          else { this.uncertain = false; this.owned = false; this.waiting('Estado reconciliado; aguardando o próximo ciclo.'); }
          return;
        }
        if (this.owned) {
          if (p.type === 'checking' && this.now() - this.startedAt < 120000) {
            this.sawChecking = true; this.status = { status: 'running', progress: p.progress, nextAt: null, message: 'Diagnóstico em andamento para medir CPU e memória.' }; this.schedule(2000); return;
          }
          if (p.type === 'checked' && this.sawChecking && this.now() - this.startedAt <= 120000 && p.valid && (p.cpu !== null || p.memory !== null)) {
            const at = this.now(), previous = this.sample;
            this.sample = { id: randomUUID(), nodeId: this.nodeId, at, cpu: p.cpu, memory: p.memory, breakBefore: !previous || at - previous.at > RESOURCE_STALE_MS };
            this.last = { nodeId: this.nodeId, cpu: p.cpu, memory: p.memory, source: 'diagnostic', sampledAt: at, current: true };
            this.owned = false; this.waiting('Diagnóstico concluído. Coleta automática ativa.', false); return;
          }
          await this.cancelOwned(); if (!current()) return;
          if (this.uncertain) { this.status = { status: 'uncertain', progress: null, nextAt: null, message: 'Diagnóstico sem conclusão confirmada; verificando o estado.' }; this.schedule(2000); }
          else { this.status = { status: 'unavailable', progress: null, nextAt: this.now() + RESOURCE_INTERVAL_MS, message: 'O ciclo não forneceu uma medição nova e válida. Resultado anterior preservado.' }; this.schedule(RESOURCE_INTERVAL_MS); }
          return;
        }
        if (busy(p.type)) { this.status = { status: 'external', progress: p.progress, nextAt: this.now() + RESOURCE_INTERVAL_MS, message: 'Outra operação está em andamento no roteador. Ela não será interrompida.' }; this.schedule(RESOURCE_INTERVAL_MS); return; }
        this.nextAllowedAt = this.now() + RESOURCE_INTERVAL_MS;
        // Firmware init itself sets check_type=checking. Follow its acknowledged init with start,
        // as the shipped panel does; do not misclassify our initialization as an external check.
        this.uncertain = true; await this.io.write('init'); if (invalidation !== this.invalidation) return; this.owned = true; this.startedAt = this.now(); this.uncertain = false; if (!current()) return;
        this.uncertain = true; await this.io.write('start'); if (invalidation !== this.invalidation) return; this.owned = true; this.uncertain = false; this.startedAt = this.now(); this.sawChecking = false;
        if (!current()) return;
        this.status = { status: 'running', progress: 0, nextAt: null, message: 'Diagnóstico iniciado para medir CPU e memória.' }; this.schedule(2000);
      } catch (error) {
        if (!current()) return;
        if (error && typeof error === 'object' && 'code' in error && error.code === 'AUTH') { this.invalidate(); return; }
        this.status = { status: this.uncertain ? 'uncertain' : 'unavailable', progress: null, nextAt: this.now() + RESOURCE_INTERVAL_MS, message: this.uncertain ? 'Envio sem confirmação; o estado será consultado antes de outro ciclo.' : 'Não foi possível acompanhar o diagnóstico sem operações adicionais.' };
        this.schedule(this.uncertain || this.owned ? 2000 : RESOURCE_INTERVAL_MS);
      }
    };
    this.task = work().finally(() => { this.task = undefined; if (generation !== this.generation && this.enabled && !this.blocked && !this.timer) this.schedule(this.uncertain ? 0 : Math.max(0,this.nextAllowedAt-this.now())); }); return this.task;
  }
}

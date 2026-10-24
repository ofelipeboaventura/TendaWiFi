import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { validateRouterHost } from './router/transport';
import { AppError } from './errors';

export interface AutoLoginConfig { host: string; password: string }
const keys = ['TENDA_ROUTER_HOST', 'TENDA_ROUTER_PASSWORD', 'TENDA_AUTO_LOGIN'] as const;
const schema = z.object({ TENDA_ROUTER_HOST: z.string().max(15).default('192.168.0.1'), TENDA_ROUTER_PASSWORD: z.string().max(63).default(''), TENDA_AUTO_LOGIN: z.enum(['true', 'false']).default('false') }).strict();

/** Backend only. Never import from the renderer or return its result over IPC. */
export async function loadAutoLoginConfig(directory: string, environment: NodeJS.ProcessEnv = process.env): Promise<AutoLoginConfig | null> {
  let source: Record<string, string | undefined> = {};
  for (const filename of ['.env.local', '.env']) {
    let handle;
    try {
      handle = await open(join(directory, filename), 'r'); const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16_384) throw new AppError('VALIDATION', 'O arquivo de configuração de login automático é inválido ou excede o limite.');
      const buffer = Buffer.alloc(stat.size); const read = await handle.read(buffer, 0, buffer.length, 0); const after = await handle.stat();
      if (read.bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new AppError('CONFLICT', 'O arquivo de login automático mudou durante a leitura. Reinicie o aplicativo.');
      try { source = parseEnv(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); } catch { throw new AppError('VALIDATION', 'O arquivo de login automático não está em um formato válido.'); } finally { buffer.fill(0); }
      break;
    } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    finally { await handle?.close(); }
  }
  for (const key of keys) if (environment[key] !== undefined) source[key] = environment[key]!;
  const checked = schema.safeParse(source);
  if (!checked.success) throw new AppError('VALIDATION', 'Verifique os nomes e limites das variáveis TENDA no arquivo de login automático.');
  const config = checked.data;
  if (config.TENDA_AUTO_LOGIN !== 'true' || !config.TENDA_ROUTER_PASSWORD) return null;
  validateRouterHost(config.TENDA_ROUTER_HOST);
  if (/[\x00-\x1f\x7f]/.test(config.TENDA_ROUTER_PASSWORD)) throw new AppError('VALIDATION', 'A senha de login automático contém caracteres de controle inválidos.');
  return { host: config.TENDA_ROUTER_HOST, password: config.TENDA_ROUTER_PASSWORD };
}

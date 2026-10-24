import http from 'node:http';
import { isIP } from 'node:net';
import type { ErrorCode } from '../../shared/types';

export class RouterError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = 'RouterError';
  }
}

export interface RouterRequest {
  host: string;
  path: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxBytes: number;
  mutation: boolean;
}
export interface RouterResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export type RouterTransport = (request: RouterRequest) => Promise<RouterResponse>;

export function validateRouterHost(host: string): string {
  if (typeof host !== 'string' || isIP(host) !== 4 || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)) {
    throw new RouterError('VALIDATION', 'Informe um endereço IPv4 privado, sem porta ou URL.');
  }
  const [a, b, , last] = host.split('.').map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) || last === 0 || last === 255) {
    throw new RouterError('FORBIDDEN', 'A conexão é permitida somente a um roteador na rede privada.');
  }
  return host;
}

/** Uses native HTTP directly: no DNS lookup, proxy environment or redirects. */
export const httpTransport: RouterTransport = request => new Promise((resolve, reject) => {
  validateRouterHost(request.host);
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = (error?: RouterError, value?: RouterResponse) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error); else resolve(value!);
  };
  const timeout = () => new RouterError(request.mutation ? 'UNCERTAIN' : 'TIMEOUT', request.mutation
    ? 'O roteador não confirmou a operação. Consulte o estado antes de tentar novamente.'
    : 'O roteador demorou para responder.');
  const req = http.request({
    host: request.host, port: 80, method: request.method, path: request.path,
    headers: request.headers, agent: false, maxHeaderSize: 16 * 1024,
  }, res => {
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      res.destroy();
      finish(new RouterError('AUTH', 'A sessão expirou ou o roteador pediu uma nova autenticação.', status));
      return;
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > request.maxBytes) {
      res.destroy(); finish(new RouterError(request.mutation ? 'UNCERTAIN' : 'ROUTER', 'A resposta excedeu o limite permitido.')); return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > request.maxBytes) {
        res.destroy(); req.destroy();
        finish(new RouterError(request.mutation ? 'UNCERTAIN' : 'ROUTER', 'A resposta excedeu o limite permitido.'));
      } else chunks.push(chunk);
    });
    res.on('end', () => finish(undefined, { status, headers: res.headers, body: Buffer.concat(chunks) }));
    res.on('aborted', () => finish(new RouterError(request.mutation ? 'UNCERTAIN' : 'OFFLINE', 'A conexão com o roteador foi interrompida.')));
    res.on('error', () => finish(new RouterError(request.mutation ? 'UNCERTAIN' : 'OFFLINE', 'Não foi possível receber a resposta do roteador.')));
  });
  timer = setTimeout(() => { req.destroy(); finish(timeout()); }, request.timeoutMs);
  req.on('error', error => {
    const code = (error as NodeJS.ErrnoException).code;
    finish(new RouterError(request.mutation && code !== 'ECONNREFUSED' && code !== 'ENETUNREACH' ? 'UNCERTAIN' : 'OFFLINE',
      request.mutation && code !== 'ECONNREFUSED' && code !== 'ENETUNREACH'
        ? 'A confirmação foi interrompida. Consulte o estado antes de repetir a operação.'
        : 'Não foi possível alcançar o roteador. Verifique o endereço e a conexão local.'));
  });
  if (request.body) req.end(request.body); else req.end();
});

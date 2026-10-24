import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

// Compatibility with the shipped web panel, chunk-common.js module 5bfe.
// This legacy CBC protocol is not authenticated encryption or a replacement for TLS.
export const ROUTER_IV = Buffer.from('EU5H62G9ICGRNI43', 'utf8');

export function passwordDigest(password: string): string {
  return createHash('md5').update(password, 'utf8').digest('hex').toUpperCase();
}

function keyBytes(sign: string): Buffer {
  const key = Buffer.from(sign, 'utf8');
  if (![16, 24, 32].includes(key.length)) throw new Error('Invalid session key');
  return key;
}

export function encryptPayload(value: unknown, sign: string): string {
  const key = keyBytes(sign);
  const cipher = createCipheriv(`aes-${key.length * 8}-cbc`, key, ROUTER_IV);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}

export function decryptPayload(data: string, sign: string): string {
  if (!data || data.length > 8 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error('Invalid encrypted payload');
  }
  const ciphertext = Buffer.from(data, 'base64');
  if (!ciphertext.length || ciphertext.length % 16 !== 0) throw new Error('Invalid encrypted payload');
  const key = keyBytes(sign);
  const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, ROUTER_IV);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}

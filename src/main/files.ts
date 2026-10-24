import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { SelectedFile } from '../shared/types';
import { AppError } from './errors';

export const APPROVED_FIRMWARE_SHA256 = '0121bd96ee3f590f9f4a21a2b60220028f7f94f460f6579382dd15e22737dd62';
export function validateSelectedFile(kind: SelectedFile['kind'], name: string, bytes: Buffer): void {
  const ext = kind === 'firmware' ? '.bin' : '.cfg';
  const max = kind === 'firmware' ? 64 * 1024 * 1024 : 8 * 1024 * 1024;
  if (extname(name).toLowerCase() !== ext || bytes.length < 32 || bytes.length > max) throw new AppError('VALIDATION', `Selecione um arquivo ${ext.toUpperCase()} válido, dentro do limite de tamanho.`);
  if (kind === 'firmware') {
    if (bytes.readUInt32BE(0) !== bytes.length - 4 || (bytes.length - 4) % 16 !== 0 || createHash('sha256').update(bytes).digest('hex') !== APPROVED_FIRMWARE_SHA256) throw new AppError('VALIDATION', 'Este firmware não corresponde ao arquivo oficial RX27 Pro V1.0 V16.03.28.20 verificado para este aplicativo. Use a atualização online para outras versões.');
  } else {
    const header = bytes.subarray(0, 256).toString('utf8').trim().toLowerCase();
    if (bytes.subarray(0, 2).toString() === 'MZ' || bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header.startsWith('<!doctype') || header.startsWith('<html')) throw new AppError('VALIDATION', 'O arquivo selecionado não é um backup de configuração válido.');
  }
}
interface StoredFile { info: SelectedFile; bytes: Buffer; expires: number }
export interface FileStore {
  select(kind: SelectedFile['kind']): Promise<SelectedFile | null>;
  get(id: string): { info: SelectedFile; bytes: Buffer };
  take(id: string): { info: SelectedFile; bytes: Buffer };
  clear(): void;
  saveBackup(bytes: Buffer): Promise<boolean>;
}
export class FileVault implements FileStore {
  private files = new Map<string, StoredFile>();
  constructor(private window: () => BrowserWindow) {}
  async select(kind: SelectedFile['kind']): Promise<SelectedFile | null> {
    const result = await dialog.showOpenDialog(this.window(), { title: kind === 'firmware' ? 'Selecionar firmware RX27 Pro verificado' : 'Selecionar backup de configuração', properties: ['openFile'], filters: [{ name: kind === 'firmware' ? 'Firmware BIN' : 'Backup CFG', extensions: [kind === 'firmware' ? 'bin' : 'cfg'] }] });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const handle = await open(result.filePaths[0], 'r');
    try {
      const stat = await handle.stat(); const limit = kind === 'firmware' ? 64 * 1024 * 1024 : 8 * 1024 * 1024;
      if (!stat.isFile() || stat.size < 32 || stat.size > limit) throw new AppError('VALIDATION', 'Arquivo inválido ou maior que o limite permitido.');
      // Read a bounded immutable snapshot: a file growing during selection must not bypass size limits.
      const bytes = Buffer.alloc(stat.size); let total = 0;
      while (total < bytes.length) { const chunk = await handle.read(bytes, total, bytes.length - total, total); if (!chunk.bytesRead) break; total += chunk.bytesRead; }
      const after = await handle.stat();
      if (total !== bytes.length || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) { bytes.fill(0); throw new AppError('CONFLICT', 'O arquivo mudou durante a leitura. Selecione-o novamente.'); }
      const name = basename(result.filePaths[0]);
      try { validateSelectedFile(kind, name, bytes); } catch (error) { bytes.fill(0); throw error; }
      for (const [id, file] of this.files) if (file.info.kind === kind || file.expires < Date.now()) { file.bytes.fill(0); this.files.delete(id); }
      const info: SelectedFile = { id: randomUUID(), name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), kind };
      this.files.set(info.id, { info, bytes, expires: Date.now() + 10 * 60_000 }); return { ...info };
    } finally { await handle.close(); }
  }
  get(id: string) { const file = this.files.get(id); if (!file || file.expires < Date.now()) { if (file) file.bytes.fill(0); this.files.delete(id); throw new AppError('CONFLICT', 'A seleção do arquivo expirou. Selecione-o novamente.'); } return { info: { ...file.info }, bytes: file.bytes }; }
  take(id: string) { const value = this.get(id); this.files.delete(id); return value; }
  clear() { for (const file of this.files.values()) file.bytes.fill(0); this.files.clear(); }
  async saveBackup(bytes: Buffer): Promise<boolean> {
    const result = await dialog.showSaveDialog(this.window(), { title: 'Salvar backup de configuração', defaultPath: join(app.getPath('documents'), `RX27-Pro-${new Date().toISOString().slice(0, 10)}.cfg`), filters: [{ name: 'Backup de configuração', extensions: ['cfg'] }] });
    if (result.canceled || !result.filePath) return false;
    if (extname(result.filePath).toLowerCase() !== '.cfg') throw new AppError('VALIDATION', 'Salve o backup com extensão .cfg.');
    const handle = await open(result.filePath, 'w', 0o600); try { await handle.writeFile(bytes); } finally { await handle.close(); } return true;
  }
}

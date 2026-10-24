import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
vi.mock('electron', () => ({ app: {}, dialog: {} }));
import { validateSelectedFile } from '../src/main/files';

describe('native file selection boundaries', () => {
  it('rejects executable and HTML files disguised as backups', () => {
    for (const header of [Buffer.from('MZ'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('<!DOCTYPE html>')]) {
      const bytes = Buffer.concat([header, Buffer.alloc(100)]);
      expect(() => validateSelectedFile('configuration', 'router.cfg', bytes)).toThrow();
    }
  });
  it('rejects wrong extensions, empty data and oversized configuration files', () => {
    expect(() => validateSelectedFile('configuration', 'router.exe', Buffer.alloc(100))).toThrow();
    expect(() => validateSelectedFile('configuration', 'router.cfg', Buffer.alloc(0))).toThrow();
    expect(() => validateSelectedFile('configuration', 'router.cfg', Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow();
    expect(() => validateSelectedFile('configuration', 'router.cfg', Buffer.from('TENDA-SYNTHETIC-CONFIGURATION-NOT-A-REAL-BACKUP'))).not.toThrow();
  });
  it('does not mistake correct framing for firmware authenticity', () => {
    const forged = Buffer.alloc(100); forged.writeUInt32BE(96, 0);
    expect(() => validateSelectedFile('firmware', 'US_RX27_Pro.bin', forged)).toThrow(/não corresponde/);
  });
  it.skipIf(!existsSync('US_RX27_PROV1.0br_V16.03.28.20_multi_9569_TDE01.bin'))('recognizes the supplied firmware identity and rejects a one-byte alteration', () => {
    const bytes = readFileSync('US_RX27_PROV1.0br_V16.03.28.20_multi_9569_TDE01.bin');
    expect(() => validateSelectedFile('firmware', 'router.bin', bytes)).not.toThrow();
    bytes[500] ^= 1;
    expect(() => validateSelectedFile('firmware', 'router.bin', bytes)).toThrow();
  });
});

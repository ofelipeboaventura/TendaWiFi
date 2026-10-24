import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAutoLoginConfig } from '../src/main/auto-login';

async function fixture(content: string, run: (directory: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'tenda-env-test-'));
  try { await writeFile(join(dir,'.env.local'),content); await run(dir); }
  finally { await rm(join(dir,'.env.local')); await rmdir(dir); }
}
describe('backend-only optional automatic login',()=>{
  it('supports quoted passwords containing # without interpolation or evaluation',async()=>{
    await fixture('TENDA_AUTO_LOGIN=true\nTENDA_ROUTER_PASSWORD="synthetic-#-$password"',async dir=>{
      expect(await loadAutoLoginConfig(dir,{})).toEqual({host:'192.168.0.1',password:'synthetic-#-$password'});
    });
  });
  it('does not attempt login for a disabled or empty configuration',async()=>{
    await fixture('TENDA_AUTO_LOGIN=true\nTENDA_ROUTER_PASSWORD=""',async dir=>{expect(await loadAutoLoginConfig(dir,{})).toBeNull();});
    await fixture('TENDA_AUTO_LOGIN=false\nTENDA_ROUTER_PASSWORD=synthetic',async dir=>{expect(await loadAutoLoginConfig(dir,{})).toBeNull();});
  });
  it('allows the test runner to disable automatic login without changing the file',async()=>{
    await fixture('TENDA_AUTO_LOGIN=true\nTENDA_ROUTER_PASSWORD=synthetic',async dir=>{expect(await loadAutoLoginConfig(dir,{TENDA_AUTO_LOGIN:'false'})).toBeNull();});
  });
  it('rejects public hosts, unknown keys and excessive files without returning secrets in errors',async()=>{
    await fixture('TENDA_AUTO_LOGIN=true\nTENDA_ROUTER_HOST=8.8.8.8\nTENDA_ROUTER_PASSWORD=synthetic',async dir=>{await expect(loadAutoLoginConfig(dir,{})).rejects.toMatchObject({code:'FORBIDDEN'});});
    await fixture('TENDA_AUTO_LOGIN=true\nTENDA_ROUTER_PASSWORD=synthetic\nVITE_PASSWORD=unsafe',async dir=>{await expect(loadAutoLoginConfig(dir,{})).rejects.toMatchObject({code:'VALIDATION'});});
    await fixture('#'.repeat(20_000),async dir=>{await expect(loadAutoLoginConfig(dir,{})).rejects.toMatchObject({code:'VALIDATION'});});
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceDiagnostics, diagnosticPercent, parseDiagnostic } from '../src/main/monitoring/diagnostics';
import { AppError } from '../src/main/errors';
import { withMaintenanceTarget, type ActionRequest } from '../src/shared/types';
import { actionSchema } from '../src/main/service';

const base = 1800000000000;
const result = (type = 'checked', cpu: unknown = '11.5%', memory: unknown = '64.8%') => ({ check_type: type, progress_rate: type==='checked'?100:40, data: [{ item_name:'run_status', item_status:type==='checked'?'unoptimize':'checking', result:'normal', details:{cpu_rate:cpu,mem_rate:memory} }] });
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(base);
  let state: unknown = {check_type:'',data:[]};
  const io = {read:vi.fn(async()=>state),write:vi.fn(async(action:'init'|'start'|'stop')=>{state=action==='start'?result('checking'):action==='stop'?{check_type:'checked',data:[]}:{check_type:'',data:[]};})};
  const diagnostic = new ResourceDiagnostics(io);
  return {io,diagnostic,set:(value:unknown)=>{state=value;},start:async()=>{await diagnostic.configure(true,'primary');await vi.advanceTimersByTimeAsync(0);},finish:async()=>{await vi.advanceTimersByTimeAsync(2000);state=result();await vi.advanceTimersByTimeAsync(2000);}};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('maintenance request targets',()=>{
  it.each(['primary','secondary'])('keeps global requests valid while %s is selected',selected=>{
    const global: ActionRequest[]=[{action:'meshOptimize'},{action:'meshScan'},{action:'meshAdd',nodeSerial:'SYNTHETIC-123'},{action:'restore',fileId:'123e4567-e89b-42d3-a456-426614174000'},{action:'changePassword',oldPassword:'synthetic-old',newPassword:'synthetic-new',confirmPassword:'synthetic-new'},{action:'clearLogs'}];
    for(const input of global){const request=withMaintenanceTarget(input,selected);expect(request).toEqual(input);expect(actionSchema.safeParse(request).success).toBe(true);expect(actionSchema.safeParse({...request,nodeId:selected}).success).toBe(false);}
    for(const action of ['reboot','reset','checkFirmware','upgradeOnline'] as const)expect(actionSchema.parse(withMaintenanceTarget({action},selected))).toEqual({action,nodeId:selected});
    expect(withMaintenanceTarget({action:'reboot',nodeId:'explicit'},selected)).toEqual({action:'reboot',nodeId:'explicit'});
  });
});
describe('diagnostic response validation',()=>{
  it('accepts bounded percentages and rejects invalid values',()=>{for(const value of [NaN,Infinity,-1,101,'1e2',' 25%','<img>',{},'100.1%'])expect(diagnosticPercent(value)).toBeNull();for(const value of [0,100,'0%','11.5%','64.8'])expect(diagnosticPercent(value)).not.toBeNull();});
  it('rejects malformed states and excessive arrays',()=>{for(const value of [{check_type:'execute'},{data:Array(33).fill({item_name:'run_status'})},{progress_rate:{}},null])expect(()=>parseDiagnostic(value)).toThrow();});
});
describe('single-flight active resource checks',()=>{
  it('ignores a late init acknowledgement across a session boundary and resumes scheduling safely',async()=>{const t=setup();let acknowledge!:()=>void;t.io.write.mockImplementationOnce(()=>new Promise<void>(resolve=>{acknowledge=resolve;}));await t.start();t.diagnostic.invalidate(true);await t.diagnostic.configure(true,'new-primary');await vi.advanceTimersByTimeAsync(0);acknowledge();await vi.advanceTimersByTimeAsync(0);expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','init','start']);await t.finish();expect(t.diagnostic.latestSample()?.nodeId).toBe('new-primary');t.diagnostic.invalidate();});
  it('enforces the five minute start interval across repeated preference toggles',async()=>{const t=setup();await t.start();await t.diagnostic.configure(false,'primary');await t.diagnostic.configure(true,'primary');await vi.advanceTimersByTimeAsync(20000);expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start','stop']);t.diagnostic.invalidate();});
  it('never starts when the firmware omits its diagnostic state',async()=>{const t=setup();t.set({data:[]});await t.start();expect(t.io.write).not.toHaveBeenCalled();expect(t.diagnostic.snapshot().status).toBe('unavailable');t.diagnostic.invalidate();});
  it('recognizes transport authentication failures and stops the scheduler',async()=>{const t=setup();t.io.read.mockRejectedValue(Object.assign(new Error('Expired'),{code:'AUTH'}));await t.start();expect(t.diagnostic.snapshot().status).toBe('disabled');expect(t.io.write).not.toHaveBeenCalled();});
  it('follows an acknowledged init with start even when init sets checking like the real firmware',async()=>{const t=setup();t.io.write.mockImplementation(async action=>{t.set(action==='stop'?{check_type:'checked',data:[]}:result('checking'));});await t.start();expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start']);await t.finish();expect(t.diagnostic.latestSample()?.cpu).toBe(11.5);t.diagnostic.invalidate();});
  it('starts only check init/start, records one completed measurement, and waits five minutes',async()=>{
    const t=setup();await t.start();expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start']);expect(t.diagnostic.latestSample()).toBeUndefined();await t.finish();
    const sample=t.diagnostic.latestSample();expect(sample).toMatchObject({nodeId:'primary',at:base+4000,cpu:11.5,memory:64.8});expect(t.diagnostic.reading()[0]).toMatchObject({sampledAt:base+4000,current:true});
    await vi.advanceTimersByTimeAsync(295999);expect(t.io.write).toHaveBeenCalledTimes(2);expect(t.diagnostic.latestSample()).toEqual(sample);await vi.advanceTimersByTimeAsync(1);expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start','init','start']);t.diagnostic.invalidate();
  });
  it('does not label passive results as current, and ages a confirmed reading after six minutes',async()=>{const t=setup();t.diagnostic.passive(result(),'primary');expect(t.diagnostic.reading()[0]).toMatchObject({cpu:11.5,sampledAt:null,current:false});await t.start();await t.finish();await t.diagnostic.configure(false,'primary');vi.setSystemTime(base+364001);expect(t.diagnostic.reading()[0].current).toBe(false);expect(t.diagnostic.reading()[0].cpu).toBe(11.5);});
  it.each(['checking','optimizing'])('never resets or cancels an existing %s operation',async type=>{const t=setup();t.set(result(type));await t.start();expect(t.diagnostic.snapshot().status).toBe('external');await t.diagnostic.configure(false,'primary');expect(t.io.write).not.toHaveBeenCalled();});
  it('requires observing the new checking state, even when old percentages match',async()=>{const t=setup();await t.start();t.set(result());await vi.advanceTimersByTimeAsync(2000);expect(t.diagnostic.latestSample()).toBeUndefined();expect(t.diagnostic.snapshot().status).toBe('unavailable');t.diagnostic.invalidate();});
  it('accepts equal percentages from a distinct confirmed cycle',async()=>{const t=setup();await t.start();await t.finish();const first=t.diagnostic.latestSample();await vi.advanceTimersByTimeAsync(300000);await t.finish();expect(t.diagnostic.latestSample()?.id).not.toBe(first?.id);expect(t.diagnostic.latestSample()?.cpu).toBe(first?.cpu);t.diagnostic.invalidate();});
  it('does not record interrupted or entirely invalid resource results',async()=>{const t=setup();await t.start();await vi.advanceTimersByTimeAsync(2000);const bad=result('checked','-1%','999%');t.set(bad);await vi.advanceTimersByTimeAsync(2000);expect(t.diagnostic.latestSample()).toBeUndefined();t.diagnostic.invalidate();});
  it('does not repeat a timed-out start and reconciles before scheduling another attempt',async()=>{const t=setup();t.io.write.mockImplementation(async action=>{if(action==='start')throw new AppError('UNCERTAIN','Synthetic timeout');});await t.start();expect(t.diagnostic.snapshot().status).toBe('uncertain');t.set(result('checking'));await vi.advanceTimersByTimeAsync(10000);expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start']);t.set(result());await vi.advanceTimersByTimeAsync(2000);expect(t.diagnostic.latestSample()).toBeUndefined();expect(t.diagnostic.snapshot().status).toBe('waiting');t.diagnostic.invalidate();});
  it('stops its own check at the two minute deadline without accepting late results',async()=>{const t=setup();await t.start();await vi.advanceTimersByTimeAsync(120000);expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start','stop']);expect(t.diagnostic.latestSample()).toBeUndefined();t.diagnostic.invalidate();});
  it('gives maintenance priority and cancels only its owned check',async()=>{const t=setup();await t.start();const release=await t.diagnostic.maintenance();expect(t.io.write.mock.calls.map(c=>c[0])).toEqual(['init','start','stop']);await vi.advanceTimersByTimeAsync(400000);expect(t.io.write).toHaveBeenCalledTimes(3);release();await vi.advanceTimersByTimeAsync(300000);expect(t.io.write).toHaveBeenCalledTimes(5);t.diagnostic.invalidate();});
  it('blocks maintenance if cancellation cannot be confirmed',async()=>{const t=setup();await t.start();t.io.write.mockImplementation(async action=>{if(action==='stop')throw new AppError('UNCERTAIN','Synthetic timeout');});await expect(t.diagnostic.maintenance()).rejects.toMatchObject({code:'UNCERTAIN'});expect(t.diagnostic.latestSample()).toBeUndefined();t.diagnostic.invalidate();});
  it('invalidates a sleep boundary and cannot accept the previous cycle on resume',async()=>{const t=setup();await t.start();await vi.advanceTimersByTimeAsync(2000);t.diagnostic.invalidate();t.set(result());await t.diagnostic.configure(true,'primary');await vi.advanceTimersByTimeAsync(0);expect(t.diagnostic.latestSample()).toBeUndefined();expect(t.diagnostic.snapshot().status).toBe('waiting');t.diagnostic.invalidate();});
  it('stops scheduling on an expired session',async()=>{const t=setup();await t.start();t.io.read.mockRejectedValue(new AppError('AUTH','Synthetic expired session'));await vi.advanceTimersByTimeAsync(10000);expect(t.diagnostic.snapshot().status).toBe('disabled');expect(t.diagnostic.latestSample()).toBeUndefined();});
});

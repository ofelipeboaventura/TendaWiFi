import {afterEach,describe,expect,it,vi}from'vitest';
const mocks=vi.hoisted(()=>({packaged:true,enabled:false,set:vi.fn(),get:vi.fn(),stat:vi.fn(async()=>({isFile:()=>true}))}));
vi.mock('electron',()=>({app:{get isPackaged(){return mocks.packaged;},getLoginItemSettings:(options:unknown)=>{mocks.get(options);return{openAtLogin:mocks.enabled};},setLoginItemSettings:(options:{openAtLogin:boolean})=>{mocks.set(options);mocks.enabled=options.openAtLogin;}}}));
vi.mock('node:fs/promises',()=>({stat:mocks.stat}));
import{startupStatus,setStartup}from'../src/main/startup';
const original=process.env.PORTABLE_EXECUTABLE_FILE;
afterEach(()=>{if(original===undefined)delete process.env.PORTABLE_EXECUTABLE_FILE;else process.env.PORTABLE_EXECUTABLE_FILE=original;mocks.enabled=false;mocks.packaged=true;vi.clearAllMocks();});
describe('portable startup boundary',()=>{
 it('registers the original portable path with fixed hidden arguments, not the extraction executable',async()=>{process.env.PORTABLE_EXECUTABLE_FILE='C:\\Program Files\\TendaWiFi-0.5.0.exe';expect(await setStartup(true)).toEqual({enabled:true,supported:true});expect(mocks.set).toHaveBeenCalledWith({openAtLogin:true,path:'C:\\Program Files\\TendaWiFi-0.5.0.exe',args:['--hidden'],name:'TendaWiFiDesktop'});expect(mocks.get).toHaveBeenLastCalledWith({path:'C:\\Program Files\\TendaWiFi-0.5.0.exe',args:['--hidden']});});
 it('does not modify Windows when running from source or given an unsafe executable target',async()=>{mocks.packaged=false;expect(startupStatus().supported).toBe(false);await expect(setStartup(true)).rejects.toMatchObject({code:'UNSUPPORTED'});mocks.packaged=true;process.env.PORTABLE_EXECUTABLE_FILE='\\\\server\\share\\TendaWiFi.exe';await expect(setStartup(true)).rejects.toMatchObject({code:'VALIDATION'});process.env.PORTABLE_EXECUTABLE_FILE='C:\\app.exe --script';await expect(setStartup(true)).rejects.toMatchObject({code:'VALIDATION'});expect(mocks.set).not.toHaveBeenCalled();});
});

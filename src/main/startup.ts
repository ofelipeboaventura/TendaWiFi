import { app } from 'electron';
import { isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { AppError } from './errors';
function executable(){const portable=process.env.PORTABLE_EXECUTABLE_FILE;return portable&&isAbsolute(portable)?portable:process.execPath;}
export function startupStatus(){const supported=process.platform==='win32'&&app.isPackaged;return{enabled:supported&&app.getLoginItemSettings({path:executable(),args:['--hidden']}).openAtLogin,supported};}
export async function setStartup(enabled:boolean){
  if(!startupStatus().supported)throw new AppError('UNSUPPORTED','Inicialização automática disponível no executável portátil Windows.');
  const path=executable();if(!isAbsolute(path)||path.startsWith('\\\\')||!path.toLowerCase().endsWith('.exe')||!(await stat(path)).isFile())throw new AppError('VALIDATION','O executável original não está disponível neste caminho.');
  app.setLoginItemSettings({openAtLogin:enabled,path,args:['--hidden'],name:'TendaWiFiDesktop'});
  const current=startupStatus();if(current.enabled!==enabled)throw new AppError('INTERNAL','O Windows não confirmou a configuração de inicialização.');return current;
}

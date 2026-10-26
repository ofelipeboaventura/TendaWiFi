import {spawn} from 'node:child_process';
import electron from 'electron';
const env={...process.env,TENDA_AUTO_LOGIN:'false'};delete env.ELECTRON_RUN_AS_NODE;delete env.TENDA_DEV_URL;
const child=spawn(electron,['scripts/smoke-electron.cjs',...(process.argv.includes('--packaged-asar')?['--packaged-asar']:[]),...process.argv.filter(a=>/^--version=0\.(?:[34]\.0|5\.[012])$/.test(a))],{stdio:'inherit',windowsHide:true,env});
child.on('error',()=>{process.exitCode=1});child.on('exit',code=>process.exit(code??1));

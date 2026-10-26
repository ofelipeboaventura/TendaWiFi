import {spawn}from'node:child_process';
import electron from'electron';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.TENDA_ROUTER_PASSWORD;
const child=spawn(electron,['scripts/generate-icons.cjs'],{env,windowsHide:true,stdio:'inherit'});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>process.exit(code??1));

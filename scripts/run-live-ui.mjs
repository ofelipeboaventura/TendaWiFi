import {spawn} from 'node:child_process';import electron from 'electron';
if(!process.argv.includes('--read-only-live'))throw Error('Explicit --read-only-live is required');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.TENDA_DEV_URL;
const child=spawn(electron,['scripts/live-ui-read.cjs','--read-only-live'],{stdio:'inherit',windowsHide:true,env});child.on('exit',code=>process.exit(code??1));

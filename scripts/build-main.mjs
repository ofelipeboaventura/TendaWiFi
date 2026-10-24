import { build } from 'esbuild';
await build({entryPoints:['src/main/index.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],outfile:'out/main.cjs',sourcemap:false});
await build({entryPoints:['src/main/preload.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],outfile:'out/preload.cjs',sourcemap:false});

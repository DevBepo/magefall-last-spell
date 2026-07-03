import { spawn } from 'node:child_process';

const env = { ...process.env, PORT: '3100', VITE_PORT: '5180', SERVER_PORT: '3100', ALLOW_TEST_MODE: 'true' };
const children = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--strictPort'], { env, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/src/index.ts'], { env, stdio: 'inherit' }),
];
const stop = () => { for (const child of children) child.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', stop);
for (const child of children) child.on('exit', code => { if (code && code !== 0) process.exit(code); });

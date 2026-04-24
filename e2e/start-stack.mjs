import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..').replace(/^\/([A-Za-z]:)/, '$1');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dbPath = path.join(os.tmpdir(), `condoos-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
const children = [];

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => code === 0 ? resolve(undefined) : reject(new Error(`${npm} ${args.join(' ')} exited ${code}`)));
  });
}

function start(args, env = {}) {
  const child = spawn(npm, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: false,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) process.exit(code ?? 1);
  });
  return child;
}

let shuttingDown = false;
function shutdown() {
  shuttingDown = true;
  for (const child of children) child.kill();
  try { fs.rmSync(dbPath, { force: true }); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[e2e] DB_PATH=${dbPath}`);
await run(['--prefix', 'server', 'run', 'seed'], { DB_PATH: dbPath, NODE_ENV: 'development' });
start(['--prefix', 'server', 'exec', '--', 'ts-node', 'src/server.ts'], {
  DB_PATH: dbPath,
  NODE_ENV: 'production',
  PORT: '4312',
  JWT_SECRET: 'e2e-secret',
  CORS_ORIGIN: 'http://localhost:5175',
});
start(['--prefix', 'client-app', 'exec', '--', 'vite', '--host', 'localhost', '--port', '5175'], {
  VITE_API_URL: 'http://localhost:4312/api',
});

process.stdin.resume();

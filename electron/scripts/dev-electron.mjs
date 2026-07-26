import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const demo = process.env.ECO_UI_DEMO !== '0';
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function waitForServer(target, attempts = 80) {
  return new Promise((resolve, reject) => {
    let left = attempts;
    const tick = () => {
      const req = http.get(target, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        left -= 1;
        if (left <= 0) reject(new Error(`Vite dev server not ready: ${target}`));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

await waitForServer(url);

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.'],
  {
    cwd: electronDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: url,
      ECO_UI_DEMO: demo ? '1' : (process.env.ECO_UI_DEMO || ''),
    },
  },
);

child.on('exit', (code) => process.exit(code ?? 0));

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = fs.readFileSync(path.join(root, 'lib/ipc/register-handlers.js'), 'utf8');
const m = s.match(/const HANDLER_SOURCE = ("[\s\S]*");\s*\n\s*module/);
if (!m) {
  console.error('HANDLER_SOURCE not found');
  process.exit(1);
}
const src = JSON.parse(m[1]);
const out = path.join(root, 'lib/ipc/_extracted-handlers.js');
fs.writeFileSync(out, src);
console.log('wrote', out, 'chars', src.length, 'lines', src.split('\n').length);

const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const corePath = path.resolve(__dirname, '..', 'dist-native', 'xiaoya-core', 'XiaoyaCore.exe');
const child = spawn(corePath, [], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
});

let nextId = 1;
let hello = null;
const pending = new Map();
const errors = [];

const timeout = setTimeout(() => {
  child.kill();
  console.error('XiaoyaCore integration test timed out');
  process.exitCode = 1;
}, 10000);

function request(command, payload = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`);
  });
}

const output = readline.createInterface({ input: child.stdout });
output.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'hello') {
    hello = message;
    return;
  }
  if (message.type !== 'response') return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.ok) waiter.resolve(message.payload);
  else waiter.reject(new Error(message.payload?.error || 'Core request failed'));
});

const stderr = readline.createInterface({ input: child.stderr });
stderr.on('line', (line) => line.trim() && errors.push(line.trim()));

child.once('error', (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code) => {
  clearTimeout(timeout);
  try {
    assert.equal(code, 0);
    assert.deepEqual(errors, []);
    assert.equal(hello?.architecture, 'x86');
    assert.equal(hello?.mode, 'native-background');
    console.log('XiaoyaCore protocol, configuration validation, and safe shutdown passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});

(async () => {
  while (!hello)
    await new Promise((resolve) => setTimeout(resolve, 10));

  const handshake = await request('hello');
  assert.equal(handshake.protocol, 1);
  assert.equal(handshake.architecture, 'x86');

  const configured = await request('configure', {
    targetPid: null,
    skills: [
      { enabled: true, skillTime: 8, mouse: true, delay: 2500 }
    ]
  });
  assert.equal(configured.state.running, false);
  assert.equal(configured.state.skills.length, 6);

  await assert.rejects(
    request('start'),
    /请先选择要控制的 ECO 进程/
  );

  const stopped = await request('stop');
  assert.equal(stopped.state.running, false);
  assert.equal(stopped.state.mode, 'native-background');

  await request('shutdown');
})().catch((error) => {
  child.kill();
  console.error(error);
  process.exitCode = 1;
});

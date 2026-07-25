const assert = require('node:assert/strict');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

const port = Number(option('--port') || 9223);
const expectedPid = String(option('--target-pid'));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function findPage() {
  return waitUntil(async () => {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return pages.find((page) => page.title === 'ECO 工具箱');
    } catch {
      return null;
    }
  }, 5000, 'ECO Toolbox debug page');
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  function send(method, params = {}, timeoutMs = 5000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, 10000);
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed');
    return result.result.value;
  }

  return { socket, opened, send, evaluate };
}

const readRowsExpression = `Array.from(document.querySelectorAll('.xiaoya-skill-row')).map((row) => ({
  enabled: row.querySelector('[data-field="enabled"]').checked,
  skillTime: Number(row.querySelector('[data-field="skillTime"]').value),
  mouse: row.querySelector('[data-field="mouse"]').checked,
  delay: Number(row.querySelector('[data-field="delay"]').value)
}))`;

(async () => {
  assert.match(expectedPid, /^\d+$/, 'A numeric --target-pid is required');
  const page = await findPage();
  const client = connect(page.webSocketDebuggerUrl);
  await client.opened;
  await client.send('Runtime.enable');

  await waitUntil(
    () => client.evaluate(`document.readyState === 'complete' && Boolean(window.eco)`),
    5000,
    'renderer initialization'
  );

  const selectedPid = await client.evaluate(`document.querySelector('#game-process-select').value`);
  assert.equal(selectedPid, expectedPid, 'Electron selected the wrong ECO process');

  await client.evaluate(`document.querySelector('[data-page="xiaoya"]').click()`);
  await wait(100);

  const targetConfiguration = [
    { enabled: true, skillTime: 2, mouse: false, delay: 600 },
    { enabled: false, skillTime: 15, mouse: true, delay: 2300 },
    { enabled: false, skillTime: 15, mouse: true, delay: 2300 },
    { enabled: false, skillTime: 50, mouse: true, delay: 3000 },
    { enabled: false, skillTime: 15, mouse: true, delay: 3000 },
    { enabled: false, skillTime: 15, mouse: true, delay: 3000 }
  ];
  await client.evaluate(`(() => {
    const values = ${JSON.stringify(targetConfiguration)};
    document.querySelectorAll('.xiaoya-skill-row').forEach((row, index) => {
      const value = values[index];
      row.querySelector('[data-field="enabled"]').checked = value.enabled;
      row.querySelector('[data-field="skillTime"]').value = value.skillTime;
      row.querySelector('[data-field="mouse"]').checked = value.mouse;
      row.querySelector('[data-field="delay"]').value = value.delay;
    });
    document.querySelector('#xiaoya-config').requestSubmit();
  })()`);
  await waitUntil(async () => {
    const rows = await client.evaluate(readRowsExpression);
    return JSON.stringify(rows) === JSON.stringify(targetConfiguration);
  }, 3000, 'saved configuration');

  await client.evaluate(`document.querySelector('.xiaoya-skill-row [data-field="skillTime"]').value = 99`);
  await client.evaluate(`document.querySelector('#xiaoya-reload-config').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('.xiaoya-skill-row [data-field="skillTime"]').value === '2'`),
    3000,
    'configuration reload'
  );

  await client.evaluate(`document.querySelector('#xiaoya-toggle-ss').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('#xiaoya-message').textContent.includes('SS 模式')`),
    4000,
    'first manual SS toggle'
  );
  await client.evaluate(`document.querySelector('#xiaoya-toggle-ss').click()`);
  await wait(300);

  await client.evaluate(`document.querySelector('#xiaoya-toggle-visibility').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('#xiaoya-message').textContent.includes('隐藏')`),
    4000,
    'target window hide'
  );
  await client.evaluate(`document.querySelector('#xiaoya-toggle-visibility').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('#xiaoya-message').textContent.includes('显示')`),
    4000,
    'target window show'
  );

  await client.evaluate(`document.querySelector('#xiaoya-toggle').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('#xiaoya-state').textContent.includes('运行中')`),
    5000,
    'first automation start'
  );
  await wait(4300);
  await client.evaluate(`document.querySelector('#xiaoya-toggle').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('#xiaoya-state').textContent.includes('已停止')`),
    5000,
    'automation stop'
  );

  const stoppedSnapshot = await client.evaluate(`({
    selectedPid: document.querySelector('#game-process-select').value,
    stateText: document.querySelector('#xiaoya-state').textContent.trim(),
    message: document.querySelector('#xiaoya-message').textContent.trim(),
    rows: ${readRowsExpression}
  })`);
  assert.equal(stoppedSnapshot.selectedPid, expectedPid);
  assert.deepEqual(stoppedSnapshot.rows, targetConfiguration);

  await client.evaluate(`document.querySelector('#xiaoya-toggle').click()`);
  await waitUntil(
    () => client.evaluate(`document.querySelector('#xiaoya-state').textContent.includes('运行中')`),
    5000,
    'second automation start'
  );
  await wait(1000);

  console.log(JSON.stringify(stoppedSnapshot, null, 2));
  console.log('Electron renderer controls passed; closing while core is running');
  try {
    await client.evaluate(`window.close()`);
  } catch {
  }
  await wait(500);
  client.socket.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

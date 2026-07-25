const assert = require('node:assert/strict');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const mode = option('--mode');
const port = Number(option('--port') || 9226);
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

async function debugPage() {
  return waitUntil(async () => {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return pages.find((page) => page.title === 'ECO 工具箱');
    } catch {
      return null;
    }
  }, 5000, 'ECO Toolbox debug page');
}

async function connect() {
  const page = await debugPage();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed');
    return result.result.value;
  }

  await send('Runtime.enable');
  return { socket, evaluate };
}

(async () => {
  assert.ok(['start', 'stop'].includes(mode), '--mode must be start or stop');
  assert.match(expectedPid, /^\d+$/, '--target-pid must be numeric');
  const client = await connect();
  await waitUntil(
    () => client.evaluate(`document.readyState === 'complete' && Boolean(window.eco)`),
    5000,
    'renderer initialization'
  );
  const selectedPid = await client.evaluate(`document.querySelector('#game-process-select').value`);
  assert.equal(selectedPid, expectedPid);
  await client.evaluate(`document.querySelector('[data-page="xiaoya"]').click()`);
  await wait(100);

  if (mode === 'start') {
    const configuration = [
      { enabled: true, skillTime: 30, mouse: false, delay: 600 },
      { enabled: false, skillTime: 15, mouse: true, delay: 2300 },
      { enabled: false, skillTime: 15, mouse: true, delay: 2300 },
      { enabled: false, skillTime: 50, mouse: true, delay: 3000 },
      { enabled: false, skillTime: 15, mouse: true, delay: 3000 },
      { enabled: false, skillTime: 15, mouse: true, delay: 3000 }
    ];
    await client.evaluate(`(() => {
      const values = ${JSON.stringify(configuration)};
      document.querySelectorAll('.xiaoya-skill-row').forEach((row, index) => {
        const value = values[index];
        row.querySelector('[data-field="enabled"]').checked = value.enabled;
        row.querySelector('[data-field="skillTime"]').value = value.skillTime;
        row.querySelector('[data-field="mouse"]').checked = value.mouse;
        row.querySelector('[data-field="delay"]').value = value.delay;
      });
      document.querySelector('#xiaoya-config').requestSubmit();
      window.__realEcoEvents = [];
      window.eco.onXiaoyaEvent((event) => window.__realEcoEvents.push(event));
    })()`);
    await wait(300);

    await client.evaluate(`document.querySelector('#xiaoya-toggle-visibility').click()`);
    await waitUntil(
      () => client.evaluate(`document.querySelector('#xiaoya-message').textContent.includes('隐藏')`),
      4000,
      'real ECO window hide'
    );
    await client.evaluate(`document.querySelector('#xiaoya-toggle-visibility').click()`);
    await waitUntil(
      () => client.evaluate(`document.querySelector('#xiaoya-message').textContent.includes('显示')`),
      4000,
      'real ECO window show'
    );

    await client.evaluate(`document.querySelector('#xiaoya-toggle').click()`);
    await waitUntil(
      () => client.evaluate(`document.querySelector('#xiaoya-state').textContent.includes('运行中')`),
      5000,
      'real ECO automation start'
    );
    await waitUntil(
      () => client.evaluate(`window.__realEcoEvents.some((event) => event.event === 'action' && event.key === 'F1')`),
      5000,
      'single F1 action event'
    );
    const result = await client.evaluate(`({
      selectedPid: document.querySelector('#game-process-select').value,
      stateText: document.querySelector('#xiaoya-state').textContent.trim(),
      message: document.querySelector('#xiaoya-message').textContent.trim(),
      actions: window.__realEcoEvents.filter((event) => event.event === 'action')
    })`);
    assert.equal(result.actions.length, 1);
    console.log(JSON.stringify(result, null, 2));
  } else {
    await client.evaluate(`document.querySelector('#xiaoya-toggle').click()`);
    await waitUntil(
      () => client.evaluate(`document.querySelector('#xiaoya-state').textContent.includes('已停止')`),
      5000,
      'real ECO automation stop'
    );
    const result = await client.evaluate(`({
      selectedPid: document.querySelector('#game-process-select').value,
      stateText: document.querySelector('#xiaoya-state').textContent.trim(),
      message: document.querySelector('#xiaoya-message').textContent.trim(),
      actions: (window.__realEcoEvents || []).filter((event) => event.event === 'action')
    })`);
    assert.equal(result.actions.length, 1);
    console.log(JSON.stringify(result, null, 2));
    await client.evaluate(`window.close()`);
  }
  client.socket.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

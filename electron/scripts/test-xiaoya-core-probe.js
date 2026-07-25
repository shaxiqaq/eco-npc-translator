const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

const corePath = option('--core');
const probePath = option('--probe');
const outputRoot = option('--output');

if (!corePath || !probePath || !outputRoot) {
  console.error('Usage: node test-xiaoya-core-probe.js --core <exe> --probe <exe> --output <dir>');
  process.exit(2);
}

fs.mkdirSync(outputRoot, { recursive: true });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createProtocolClient(child) {
  let hello = null;
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const stderr = [];

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.type === 'hello') {
      hello = message;
      return;
    }
    if (message.type === 'event') {
      events.push(message);
      return;
    }
    if (message.type !== 'response') return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.ok) waiter.resolve(message.payload);
    else waiter.reject(new Error(message.payload?.error || `${waiter.command} failed`));
  });
  readline.createInterface({ input: child.stderr }).on('line', (line) => {
    if (line.trim()) stderr.push(line.trim());
  });

  function request(command, payload = {}, timeoutMs = 5000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for core command ${command}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout, command });
      child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`);
    });
  }

  return {
    events,
    stderr,
    request,
    waitForHello: () => waitUntil(() => hello, 5000, 'core hello')
  };
}

function makeSkills({ enabledKeys = [1], interval = 2, mouse = false, delay = 600 }) {
  return Array.from({ length: 6 }, (_, index) => ({
    enabled: enabledKeys.includes(index + 1),
    skillTime: interval,
    mouse,
    delay
  }));
}

async function runCase(definition) {
  const caseDirectory = path.join(outputRoot, definition.name);
  fs.mkdirSync(caseDirectory, { recursive: true });
  const messageLog = path.join(caseDirectory, 'messages.jsonl');
  const probe = spawn(probePath, ['--log', messageLog], {
    windowsHide: false,
    stdio: 'ignore'
  });
  let core = null;

  try {
    const ready = await waitUntil(() => {
      const entries = readJsonLines(messageLog);
      return entries.find((entry) => entry.name === 'probe-ready');
    }, 5000, `${definition.name} probe window`);
    assert.equal(ready.decoded.processId, probe.pid);
    await wait(250);

    core = spawn(corePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const client = createProtocolClient(core);
    const hello = await client.waitForHello();
    assert.equal(hello.architecture, 'x86');
    assert.equal(hello.mode, 'native-background');

    await client.request('configure', {
      targetPid: probe.pid,
      skills: definition.skills
    });
    await client.request('start');
    await wait(definition.durationMs);
    await client.request('stop');
    await client.request('shutdown');
    await waitUntil(() => core.exitCode !== null, 5000, `${definition.name} core exit`);
    assert.equal(core.exitCode, 0);
    assert.deepEqual(client.stderr, []);

    const entries = readJsonLines(messageLog);
    fs.writeFileSync(
      path.join(caseDirectory, 'core-events.json'),
      `${JSON.stringify(client.events, null, 2)}\n`,
      'utf8'
    );
    return { ...definition, entries, events: client.events, probePid: probe.pid };
  } finally {
    if (core && core.exitCode === null) core.kill();
    if (probe.exitCode === null) probe.kill();
    await wait(100);
  }
}

async function runManualControls() {
  const name = 'manual-controls';
  const caseDirectory = path.join(outputRoot, name);
  fs.mkdirSync(caseDirectory, { recursive: true });
  const messageLog = path.join(caseDirectory, 'messages.jsonl');
  const probe = spawn(probePath, ['--log', messageLog], {
    windowsHide: false,
    stdio: 'ignore'
  });
  let core = null;

  try {
    const ready = await waitUntil(() => {
      const entries = readJsonLines(messageLog);
      return entries.find((entry) => entry.name === 'probe-ready');
    }, 5000, 'manual controls probe window');
    assert.equal(ready.decoded.processId, probe.pid);
    await wait(250);

    core = spawn(corePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const client = createProtocolClient(core);
    await client.waitForHello();
    await client.request('configure', {
      targetPid: probe.pid,
      skills: makeSkills({ enabledKeys: [], interval: 30, mouse: false, delay: 0 })
    });

    await client.request('toggle-ss');
    await wait(150);
    await client.request('toggle-ss');
    await wait(150);
    const hidden = await client.request('toggle-visibility');
    await wait(250);
    const shown = await client.request('toggle-visibility');
    await wait(250);

    await client.request('shutdown');
    await waitUntil(() => core.exitCode !== null, 5000, 'manual controls core exit');
    assert.equal(core.exitCode, 0);
    assert.deepEqual(client.stderr, []);

    const entries = readJsonLines(messageLog);
    fs.writeFileSync(
      path.join(caseDirectory, 'core-events.json'),
      `${JSON.stringify(client.events, null, 2)}\n`,
      'utf8'
    );
    return {
      name,
      entries,
      events: client.events,
      probePid: probe.pid,
      hiddenVisibleState: hidden.visible,
      shownVisibleState: shown.visible
    };
  } finally {
    if (core && core.exitCode === null) core.kill();
    if (probe.exitCode === null) probe.kill();
    await wait(100);
  }
}

function keyMessages(result, virtualKey, name) {
  return result.entries.filter((entry) =>
    entry.name === name &&
    entry.wParam === virtualKey
  );
}

function assertKeyPair(result, virtualKey, scanCode) {
  const downs = keyMessages(result, virtualKey, 'WM_KEYDOWN');
  const ups = keyMessages(result, virtualKey, 'WM_KEYUP');
  assert.ok(downs.length >= 1, `${result.name}: missing keydown ${virtualKey}`);
  assert.ok(ups.length >= 1, `${result.name}: missing keyup ${virtualKey}`);
  assert.equal(downs[0].decoded.scanCode, scanCode);
  assert.equal(downs[0].decoded.previousState, false);
  assert.equal(downs[0].decoded.transitionState, false);
  assert.equal(ups[0].decoded.scanCode, scanCode);
  assert.equal(ups[0].decoded.previousState, true);
  assert.equal(ups[0].decoded.transitionState, true);
  const heldMs = ups[0].elapsedMs - downs[0].elapsedMs;
  assert.ok(heldMs >= 25 && heldMs <= 90, `${result.name}: key held ${heldMs} ms`);
}

function assertSsToggle(result) {
  const tDowns = keyMessages(result, 0x54, 'WM_KEYDOWN');
  const tUps = keyMessages(result, 0x54, 'WM_KEYUP');
  const controlChars = result.entries.filter((entry) =>
    entry.name === 'WM_CHAR' && entry.wParam === 0x14
  );
  const plainTChars = result.entries.filter((entry) =>
    entry.name === 'WM_CHAR' && entry.wParam === 0x74
  );
  const controlKeyMessages = result.entries.filter((entry) =>
    ['WM_KEYDOWN', 'WM_KEYUP'].includes(entry.name) && entry.wParam === 0x11
  );
  assert.equal(tDowns.length, 2, `${result.name}: expected start and stop Ctrl+T`);
  assert.equal(tUps.length, 2, `${result.name}: expected start and stop T release`);
  assert.ok(controlChars.length >= 1, `${result.name}: Ctrl state was not visible to probe`);
  assert.equal(plainTChars.length, 0, `${result.name}: T was translated without Ctrl`);
  assert.equal(controlKeyMessages.length, 0, `${result.name}: target received an unexpected Ctrl message`);
  for (let index = 0; index < 2; index++) {
    const heldMs = tUps[index].elapsedMs - tDowns[index].elapsedMs;
    assert.ok(heldMs >= 60 && heldMs <= 160, `${result.name}: T held ${heldMs} ms`);
  }
}

function f1DownTimes(result) {
  return keyMessages(result, 0x70, 'WM_KEYDOWN').map((entry) => entry.elapsedMs);
}

function intervals(values) {
  return values.slice(1).map((value, index) => value - values[index]);
}

function assertMouseSequence(result, expected) {
  const mouse = result.entries.filter((entry) =>
    ['WM_MOUSEMOVE', 'WM_LBUTTONDOWN', 'WM_LBUTTONUP'].includes(entry.name)
  );
  if (!expected) {
    assert.equal(mouse.length, 0, `${result.name}: unexpected mouse messages`);
    return;
  }
  assert.ok(mouse.length >= 4, `${result.name}: missing mouse click`);
  for (let index = 0; index + 3 < mouse.length; index += 4) {
    const group = mouse.slice(index, index + 4);
    assert.deepEqual(
      group.map((entry) => [entry.name, entry.wParam]),
      [
        ['WM_MOUSEMOVE', 2],
        ['WM_LBUTTONDOWN', 1],
        ['WM_MOUSEMOVE', 2],
        ['WM_LBUTTONUP', 0]
      ]
    );
    assert.equal(group[0].decoded.x, group[1].decoded.x);
    assert.equal(group[0].decoded.y, group[1].decoded.y);
    assert.equal(group[0].decoded.x, group[3].decoded.x);
    assert.equal(group[0].decoded.y, group[3].decoded.y);
    const heldMs = group[3].elapsedMs - group[1].elapsedMs;
    assert.ok(heldMs >= 25 && heldMs <= 90, `${result.name}: mouse held ${heldMs} ms`);
  }
}

function summarize(result) {
  return {
    name: result.name,
    probePid: result.probePid,
    f1DownTimes: f1DownTimes(result),
    f1Intervals: intervals(f1DownTimes(result)),
    mouseMessages: result.entries.filter((entry) => entry.name.startsWith('WM_MOUSE')).length +
      result.entries.filter((entry) => entry.name.startsWith('WM_LBUTTON')).length,
    actionEvents: result.events.filter((event) => event.event === 'action').length
  };
}

(async () => {
  const definitions = [
    {
      name: 'all-function-keys',
      skills: makeSkills({ enabledKeys: [1, 2, 3, 4, 5, 6], interval: 30, delay: 0 }),
      durationMs: 700
    },
    {
      name: 'short-delay-mouse-off',
      skills: makeSkills({ interval: 2, mouse: false, delay: 600 }),
      durationMs: 4600
    },
    {
      name: 'short-delay-mouse-on',
      skills: makeSkills({ interval: 2, mouse: true, delay: 600 }),
      durationMs: 4600
    },
    {
      name: 'long-delay-mouse-off',
      skills: makeSkills({ interval: 1, mouse: false, delay: 3000 }),
      durationMs: 6500
    },
    {
      name: 'long-delay-mouse-on',
      skills: makeSkills({ interval: 1, mouse: true, delay: 3000 }),
      durationMs: 6700
    }
  ];

  const results = [];
  for (const definition of definitions) {
    process.stdout.write(`Running ${definition.name}... `);
    const result = await runCase(definition);
    assertSsToggle(result);
    results.push(result);
    console.log('captured');
  }

  const allKeys = results[0];
  const scanCodes = [0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x40];
  for (let index = 0; index < 6; index++) {
    assertKeyPair(allKeys, 0x70 + index, scanCodes[index]);
    assert.equal(keyMessages(allKeys, 0x70 + index, 'WM_KEYDOWN').length, 1);
  }

  for (const result of results.slice(1)) {
    assertKeyPair(result, 0x70, 0x3B);
    const measuredIntervals = intervals(f1DownTimes(result));
    assert.ok(measuredIntervals.length >= 2, `${result.name}: too few F1 cycles`);
    if (result.name.startsWith('short-delay')) {
      for (const measured of measuredIntervals)
        assert.ok(measured >= 1950 && measured <= 2075, `${result.name}: interval ${measured} ms`);
    } else {
      for (const measured of measuredIntervals)
        assert.ok(measured >= 3020 && measured <= 3200, `${result.name}: interval ${measured} ms`);
    }
    assertMouseSequence(result, result.name.endsWith('mouse-on'));
  }

  process.stdout.write('Running manual-controls... ');
  const manualControls = await runManualControls();
  assertSsToggle(manualControls);
  assert.equal(keyMessages(manualControls, 0x70, 'WM_KEYDOWN').length, 0);
  assert.equal(manualControls.hiddenVisibleState, false);
  assert.equal(manualControls.shownVisibleState, true);
  const visibilityEvents = manualControls.entries.filter((entry) =>
    entry.name === 'WM_SHOWWINDOW' && entry.elapsedMs > 200
  );
  assert.ok(
    visibilityEvents.some((entry) => entry.wParam === 0),
    'manual-controls: missing hide event'
  );
  assert.ok(
    visibilityEvents.some((entry) => entry.wParam === 1),
    'manual-controls: missing show event'
  );
  console.log('captured');

  const summary = [
    ...results.map(summarize),
    {
      name: manualControls.name,
      probePid: manualControls.probePid,
      ssToggles: keyMessages(manualControls, 0x54, 'WM_KEYDOWN').length,
      hiddenVisibleState: manualControls.hiddenVisibleState,
      shownVisibleState: manualControls.shownVisibleState
    }
  ];
  fs.writeFileSync(
    path.join(outputRoot, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log('XiaoyaCore harmless probe comparison passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStateBus } = require('../lib/state-bus');

test('state bus throttles light state and keeps dedicated channels immediate', async () => {
  const sent = [];
  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload })
    }
  };

  let lightCalls = 0;
  const bus = createStateBus({
    getWindows: () => [fakeWin],
    buildLightState: () => {
      lightCalls += 1;
      return { n: lightCalls };
    },
    buildFullState: () => ({ full: true })
  });

  bus.broadcastState();
  bus.broadcastState();
  bus.broadcastState();
  assert.equal(sent.length, 0, 'throttled until timer');

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.filter((s) => s.channel === 'app:state').length, 1);
  assert.equal(sent[0].payload.n, 1);

  bus.broadcastSnapshot({ total: 1 });
  bus.broadcastLog({ message: 'hi' });
  assert.ok(sent.some((s) => s.channel === 'damage:snapshot'));
  assert.ok(sent.some((s) => s.channel === 'service:log'));
});

test('overlay window receives slim snapshot without combat history', () => {
  const mainSent = [];
  const overlaySent = [];
  const mainWin = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => mainSent.push({ channel, payload }) }
  };
  const overlayWin = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => overlaySent.push({ channel, payload }) }
  };
  const bus = createStateBus({
    getWindows: () => [mainWin, overlayWin],
    getOverlayWindow: () => overlayWin,
    buildLightState: () => ({}),
    buildFullState: () => ({})
  });

  const full = {
    self_id: 42,
    buffs: [{ key: 'magic_shield' }],
    skill_cooldowns: [{ skill_id: 1 }],
    skill_effect_timers: [{ skill_id: 2 }],
    damage_history: [{ damage: 100 }],
    grind: { ready: true }
  };
  bus.broadcastSnapshot(full);

  assert.equal(mainSent[0].channel, 'damage:snapshot');
  assert.deepEqual(mainSent[0].payload.damage_history, [{ damage: 100 }]);
  assert.equal(mainSent[0].payload.grind.ready, true);

  assert.equal(overlaySent[0].channel, 'damage:snapshot');
  assert.deepEqual(overlaySent[0].payload, {
    self_id: 42,
    buffs: [{ key: 'magic_shield' }],
    skill_cooldowns: [{ skill_id: 1 }],
    skill_effect_timers: [{ skill_id: 2 }]
  });
});

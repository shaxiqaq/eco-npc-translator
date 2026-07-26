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

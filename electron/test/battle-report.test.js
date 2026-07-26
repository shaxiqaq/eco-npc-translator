const test = require('node:test');
const assert = require('node:assert/strict');
const { createBattleReportTracker } = require('../lib/battle-report');

test('battle report tracks peak dps and formats text', () => {
  const tracker = createBattleReportTracker();
  tracker.ingest({ dps: 10, dealt: 100, skill_casts: [{ skill_id: 1, skill: 'Fire', count: 2 }] });
  tracker.ingest({ dps: 25, dealt: 300, skill_casts: [{ skill_id: 1, skill: 'Fire', count: 5 }] });
  const report = tracker.snapshot();
  assert.equal(report.peakDps, 25);
  assert.equal(report.peakDealt, 300);
  assert.equal(report.topSkills[0].count, 5);
  const text = tracker.formatText(report, { characterTitle: 'ECO - 法师' });
  assert.match(text, /峰值 DPS/);
  assert.match(text, /Fire/);
  assert.match(text, /法师/);
});

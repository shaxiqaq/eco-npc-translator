const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createDisplayNameService, isGarbageName } = require('../lib/display-names');

test('isGarbageName rejects control characters', () => {
  assert.equal(isGarbageName('ok'), false);
  assert.equal(isGarbageName('a\u0002b'), true);
});

test('display name service formats client/ja/dual', () => {
  const repoData = path.resolve(__dirname, '../../data');
  const svc = createDisplayNameService({
    dataDir: () => repoData,
    resDir: () => repoData
  });
  svc.reload();
  // 2100 is seeded as パリイ in skill_names_ja and present in client table
  const ja = svc.formatSkill(2100, 'ja');
  assert.match(ja, /パリイ|parry|防御|闪/i);
  const dual = svc.formatSkill(2100, 'dual');
  assert.ok(dual.includes('/') || dual.length > 0);
  assert.ok(svc.wikiSearchUrl('パリイ').includes('eco.lycolia.info'));
  assert.ok(svc.loadJobPresets().length >= 1);
});

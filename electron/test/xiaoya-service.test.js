const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeSkills,
  parseIniText,
  serializeIniText
} = require('../lib/xiaoya-service');

test('parses the original GBK INI fields after decoding', () => {
  const skills = parseIniText([
    '[设置1]',
    'F1=真',
    'F2=假',
    '[设置2]',
    '技能时间1=8',
    '技能时间2=15',
    '[设置3]',
    '鼠标1=真',
    '鼠标2=假',
    '[设置4]',
    '延迟时间1=2500',
    '延迟时间2=2300'
  ].join('\r\n'));

  assert.deepEqual(skills[0], { enabled: true, skillTime: 8, mouse: true, delay: 2500 });
  assert.deepEqual(skills[1], { enabled: false, skillTime: 15, mouse: false, delay: 2300 });
  assert.equal(skills.length, 6);
});

test('serializes six normalized skill rows', () => {
  const text = serializeIniText([
    { enabled: false, skillTime: 7, mouse: true, delay: 1200 }
  ]);

  assert.match(text, /\[设置1]\r\nF1=假/);
  assert.match(text, /\[设置2][\s\S]*技能时间1=7/);
  assert.match(text, /\[设置3][\s\S]*鼠标1=真/);
  assert.match(text, /\[设置4][\s\S]*延迟时间1=1200/);
  assert.equal(normalizeSkills([]).length, 6);
});

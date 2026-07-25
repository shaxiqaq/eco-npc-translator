const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { XiaoyaCoreService } = require('../lib/xiaoya-core-service');

test('imports the legacy INI once and persists normalized JSON configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoya-core-service-'));
  const runtimeDir = path.join(root, 'runtime');
  const legacyConfigPath = path.join(root, 'legacy.ini');
  const iconv = require('iconv-lite');
  fs.writeFileSync(legacyConfigPath, iconv.encode([
    '[设置1]',
    'F1=假',
    '[设置2]',
    '技能时间1=9',
    '[设置3]',
    '鼠标1=真',
    '[设置4]',
    '延迟时间1=1234'
  ].join('\r\n'), 'gbk'));

  try {
    const service = new XiaoyaCoreService({
      corePath: path.join(root, 'missing.exe'),
      runtimeDir,
      legacyConfigPath
    });
    const skills = service.readConfig();
    assert.deepEqual(skills[0], {
      enabled: false,
      skillTime: 9,
      mouse: true,
      delay: 1234
    });
    const stored = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'config.json'), 'utf8'));
    assert.equal(stored.version, 1);
    assert.equal(stored.skills.length, 6);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

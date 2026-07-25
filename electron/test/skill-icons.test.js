const assert = require('node:assert/strict');
const test = require('node:test');

const { SkillIconService, cacheNamespace, normalizeSkillId } = require('../lib/skill-icons');

test('normalizes valid ECO skill identifiers', () => {
  assert.equal(normalizeSkillId('3114'), 3114);
  assert.equal(normalizeSkillId(0), null);
  assert.equal(normalizeSkillId(70000), null);
});

test('uses a stable client-specific cache namespace', () => {
  assert.equal(cacheNamespace('D:\\ECO\\eco.exe'), cacheNamespace('d:\\eco\\ECO.EXE'));
  assert.notEqual(cacheNamespace('D:\\ECO\\eco.exe'), cacheNamespace('E:\\ECO\\eco.exe'));
});

test('returns cached icon data without launching the helper', async () => {
  const files = new Map([['helper.exe', Buffer.from('helper')]]);
  const fsImpl = {
    existsSync: (file) => files.has(file),
    mkdirSync: () => {},
    readFileSync: (file) => files.get(file),
    readdirSync: () => []
  };
  let launches = 0;
  const service = new SkillIconService({
    helperPath: 'helper.exe',
    cacheDir: 'cache',
    fsImpl,
    execFileFn: () => { launches += 1; }
  });
  const iconPath = pathForTest('cache', cacheNamespace('client'), '3114.png');
  const namePath = pathForTest('cache', cacheNamespace('client'), '3114.txt');
  files.set(iconPath, Buffer.from('png'));
  files.set(namePath, Buffer.from('Magic Shield'));

  const result = await service.getIcon(3114, 'client');

  assert.equal(result.ok, true);
  assert.equal(result.dataUrl, 'data:image/png;base64,cG5n');
  assert.equal(result.name, 'Magic Shield');
  assert.equal(launches, 0);
});

test('serves any-namespace cache when game path is missing', async () => {
  const ns = 'abc123cached';
  const files = new Map();
  const fsImpl = {
    existsSync: (file) => files.has(file) || file === 'cache',
    mkdirSync: () => {},
    readFileSync: (file) => files.get(file),
    readdirSync: (dir, opts) => {
      if (dir !== 'cache') return [];
      const entry = { name: ns, isDirectory: () => true };
      return opts?.withFileTypes ? [entry] : [ns];
    }
  };
  const service = new SkillIconService({
    helperPath: 'helper.exe',
    cacheDir: 'cache',
    fsImpl,
    execFileFn: () => { throw new Error('should not launch'); }
  });
  files.set(pathForTest('cache', ns, '3101.png'), Buffer.from('heat'));
  files.set(pathForTest('cache', ns, '3101.txt'), Buffer.from('Heat'));

  const result = await service.getIcon(3101, '');

  assert.equal(result.ok, true);
  assert.equal(result.name, 'Heat');
  assert.equal(result.dataUrl, `data:image/png;base64,${Buffer.from('heat').toString('base64')}`);
});

function pathForTest(...parts) {
  return require('path').join(...parts);
}

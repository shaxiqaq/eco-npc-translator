const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  UpdateService,
  initialUpdateState,
  normalizeReleaseNotes,
  updateErrorMessage
} = require('../lib/update-service');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = 0;
  }

  async checkForUpdates() {
    this.checkCalls += 1;
    this.emit('checking-for-update');
    this.emit('update-available', {
      version: '0.2.1',
      releaseName: 'ECO Toolbox v0.2.1',
      releaseNotes: '修复与改进'
    });
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
    this.emit('download-progress', {
      percent: 47.5,
      transferred: 475,
      total: 1000,
      bytesPerSecond: 200
    });
    this.emit('update-downloaded', { version: '0.2.1' });
  }

  quitAndInstall() {
    this.installCalls += 1;
  }
}

test('normalizes release notes and errors for renderer display', () => {
  assert.equal(normalizeReleaseNotes([{ note: '第一项' }, { note: '第二项' }]), '第一项\n\n第二项');
  assert.equal(normalizeReleaseNotes('单段说明'), '单段说明');
  assert.equal(updateErrorMessage(new Error('network\n timeout')), 'network timeout');
});

test('disabled update service reports unsupported state', async () => {
  const service = new UpdateService({ updater: null, currentVersion: '0.2.0', enabled: false });
  assert.deepEqual(service.snapshot(), initialUpdateState('0.2.0', false));
  assert.equal((await service.check()).ok, false);
});

test('checking never downloads until the user requests it', async () => {
  const updater = new FakeUpdater();
  const service = new UpdateService({ updater, currentVersion: '0.2.0' });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal((await service.check()).ok, true);
  assert.equal(updater.checkCalls, 1);
  assert.equal(updater.downloadCalls, 0);
  assert.equal(service.snapshot().phase, 'available');
  assert.equal(service.snapshot().availableVersion, '0.2.1');
});

test('download progress reaches downloaded state and enables installation', async () => {
  const updater = new FakeUpdater();
  const states = [];
  const service = new UpdateService({
    updater,
    currentVersion: '0.2.0',
    onState: (state) => states.push(state)
  });

  await service.check();
  assert.equal((await service.download()).ok, true);
  assert.equal(updater.downloadCalls, 1);
  assert.equal(service.snapshot().phase, 'downloaded');
  assert.equal(service.snapshot().progress.percent, 100);
  assert.ok(states.some((state) => state.phase === 'downloading' && state.progress.percent === 47.5));

  assert.equal(service.install().ok, true);
  assert.equal(updater.installCalls, 1);
});

test('download is rejected when no update is available', async () => {
  const updater = new FakeUpdater();
  const service = new UpdateService({ updater, currentVersion: '0.2.0' });
  const result = await service.download();
  assert.equal(result.ok, false);
  assert.equal(updater.downloadCalls, 0);
});

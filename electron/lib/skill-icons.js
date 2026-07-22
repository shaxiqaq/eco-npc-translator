const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function normalizeSkillId(value) {
  const skillId = Number(value);
  return Number.isInteger(skillId) && skillId > 0 && skillId <= 0xffff ? skillId : null;
}

function cacheNamespace(gamePath) {
  return crypto.createHash('sha1').update(path.resolve(gamePath).toLowerCase()).digest('hex').slice(0, 12);
}

class SkillIconService {
  constructor({ helperPath, cacheDir, execFileFn = execFile, fsImpl = fs }) {
    this.helperPath = helperPath;
    this.cacheDir = cacheDir;
    this.execFileFn = execFileFn;
    this.fs = fsImpl;
    this.memory = new Map();
    this.pending = new Map();
  }

  async getIcon(skillIdValue, gamePathValue) {
    const skillId = normalizeSkillId(skillIdValue);
    const gamePath = String(gamePathValue || '').trim();
    if (!skillId || !gamePath) return { ok: false, reason: 'unavailable' };

    const key = `${gamePath.toLowerCase()}|${skillId}`;
    if (this.memory.has(key)) return this.memory.get(key);
    if (this.pending.has(key)) return this.pending.get(key);

    const promise = this.extract(skillId, gamePath)
      .then((result) => {
        this.memory.set(key, result);
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async extract(skillId, gamePath) {
    if (!this.fs.existsSync(this.helperPath)) return { ok: false, reason: 'helper-missing' };
    const outputDir = path.join(this.cacheDir, cacheNamespace(gamePath));
    const outputPath = path.join(outputDir, `${skillId}.png`);
    this.fs.mkdirSync(outputDir, { recursive: true });

    if (!this.fs.existsSync(outputPath)) {
      const result = await this.runHelper([gamePath, String(skillId), outputPath]);
      if (!result.ok || !this.fs.existsSync(outputPath)) return result;
    }

    const data = this.fs.readFileSync(outputPath);
    return { ok: true, dataUrl: `data:image/png;base64,${data.toString('base64')}` };
  }

  runHelper(args) {
    return new Promise((resolve) => {
      this.execFileFn(
        this.helperPath,
        args,
        { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024 },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve({ ok: true });
            return;
          }
          resolve({
            ok: false,
            reason: Number(error.code) === 2 ? 'not-found' : 'extract-failed',
            error: String(stderr || error.message || '').trim()
          });
        }
      );
    });
  }
}

module.exports = { SkillIconService, cacheNamespace, normalizeSkillId };

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

  readCachedIconFiles(outputPath, namePath) {
    const hasIcon = this.fs.existsSync(outputPath);
    const hasName = this.fs.existsSync(namePath);
    if (!hasIcon && !hasName) return null;
    const result = { ok: true };
    if (hasIcon) {
      try {
        const data = this.fs.readFileSync(outputPath);
        if (data && data.length) {
          result.dataUrl = `data:image/png;base64,${data.toString('base64')}`;
        }
      } catch {
        // ignore broken icon file
      }
    }
    if (hasName) {
      try {
        result.name = this.fs.readFileSync(namePath).toString('utf8').replace(/\0/g, '').trim();
      } catch {
        // ignore broken name file
      }
    }
    if (!result.dataUrl && !result.name) return null;
    return result;
  }

  /** Load icon/name from any cache namespace (works even when eco.exe is not running). */
  getFromAnyCache(skillId) {
    const memoryKey = `*|${skillId}`;
    if (this.memory.has(memoryKey)) return this.memory.get(memoryKey);

    try {
      if (!this.fs.existsSync(this.cacheDir)) {
        return { ok: false, reason: 'unavailable' };
      }
      const dirs = this.fs.readdirSync(this.cacheDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      // Prefer entries that include a PNG icon over name-only caches.
      let best = null;
      for (const dir of dirs) {
        const outputPath = path.join(this.cacheDir, dir, `${skillId}.png`);
        const namePath = path.join(this.cacheDir, dir, `${skillId}.txt`);
        const cached = this.readCachedIconFiles(outputPath, namePath);
        if (!cached) continue;
        if (cached.dataUrl) {
          best = cached;
          break;
        }
        if (!best) best = cached;
      }
      if (best) {
        this.memory.set(memoryKey, best);
        return best;
      }
    } catch {
      // ignore scan errors
    }
    return { ok: false, reason: 'unavailable' };
  }

  async getIcon(skillIdValue, gamePathValue) {
    const skillId = normalizeSkillId(skillIdValue);
    if (!skillId) return { ok: false, reason: 'unavailable' };
    const gamePath = String(gamePathValue || '').trim();

    // No client path: still serve previously extracted cache so UI icons work offline.
    if (!gamePath) {
      return this.getFromAnyCache(skillId);
    }

    const key = `${gamePath.toLowerCase()}|${skillId}`;
    if (this.memory.has(key)) return this.memory.get(key);
    if (this.pending.has(key)) return this.pending.get(key);

    const promise = this.extract(skillId, gamePath)
      .then((result) => {
        // If extract failed for this client path, fall back to any on-disk cache.
        if (!result?.ok || (!result.dataUrl && !result.name)) {
          const fallback = this.getFromAnyCache(skillId);
          if (fallback?.ok) {
            this.memory.set(key, fallback);
            return fallback;
          }
        }
        this.memory.set(key, result);
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async extract(skillId, gamePath) {
    const outputDir = path.join(this.cacheDir, cacheNamespace(gamePath));
    const outputPath = path.join(outputDir, `${skillId}.png`);
    const namePath = path.join(outputDir, `${skillId}.txt`);
    this.fs.mkdirSync(outputDir, { recursive: true });

    let extraction = { ok: true };
    if (!this.fs.existsSync(outputPath) || !this.fs.existsSync(namePath)) {
      if (!this.fs.existsSync(this.helperPath)) extraction = { ok: false, reason: 'helper-missing' };
      else extraction = await this.runHelper([gamePath, String(skillId), outputPath, namePath]);
    }

    const cached = this.readCachedIconFiles(outputPath, namePath);
    if (cached) return cached;
    return extraction;
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

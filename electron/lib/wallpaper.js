'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const WALLPAPER_MAX_EDGE = 1920;
const WALLPAPER_JPEG_QUALITY = 82;
const WALLPAPER_INLINE_MAX_BYTES = 350 * 1024;

function mimeFromExt(ext) {
  const value = String(ext || '').toLowerCase();
  if (value === '.png') return 'image/png';
  if (value === '.webp') return 'image/webp';
  if (value === '.gif') return 'image/gif';
  if (value === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function safeBackgroundRel(rel) {
  const normalized = String(rel || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) return '';
  return normalized;
}

function backgroundProtocolUrl(rel) {
  const clean = safeBackgroundRel(rel);
  if (!clean) return '';
  return `eco-bg://local/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

function clampDim(value, fallback = 0.52) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(0.9, Math.max(0.1, n)) : fallback;
}

function clampBlur(value, fallback = 6) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : fallback;
}

function clampFit(value, fallback = 'cover') {
  const fit = String(value || fallback);
  return ['cover', 'contain', 'fill'].includes(fit) ? fit : fallback;
}

function normalizeOverlayBgMode(appearance = {}) {
  const mode = String(appearance.overlayBgMode || '').trim();
  if (mode === 'follow' || mode === 'solid' || mode === 'custom') return mode;
  if (appearance.applyToOverlay === false) return 'solid';
  return 'follow';
}

function stripAppearanceRuntimeFields(appearance) {
  if (!appearance || typeof appearance !== 'object') return appearance;
  delete appearance.backgroundDataUrl;
  delete appearance.backgroundFileUrl;
  delete appearance.backgroundUrl;
  delete appearance.overlayBackgroundDataUrl;
  delete appearance.overlayBackgroundFileUrl;
  delete appearance.overlayBackgroundUrl;
  return appearance;
}

/**
 * Wallpaper import / resolve helpers shared by main process.
 * Keeps large image IO and path safety out of main.js.
 */
function createWallpaperService({ dataDir, nativeImage, log }) {
  const imageCache = new Map();

  function backgroundsDir() {
    const dir = path.join(dataDir(), 'backgrounds');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
    return dir;
  }

  function importWallpaperImage(srcPath, kind = 'main') {
    const src = String(srcPath || '');
    if (!src || !fs.existsSync(src)) {
      throw new Error('源图片不存在');
    }

    const dir = backgroundsDir();
    const prefix = kind === 'overlay' ? 'overlay-wallpaper' : 'wallpaper';
    const stamp = Date.now().toString(36);
    let destName = `${prefix}-${stamp}.jpg`;
    let dest = path.join(dir, destName);

    let image = nativeImage.createFromPath(src);
    if (image.isEmpty()) {
      const ext = path.extname(src).toLowerCase() || '.img';
      destName = `${prefix}-${stamp}${ext}`;
      dest = path.join(dir, destName);
      fs.copyFileSync(src, dest);
    } else {
      const size = image.getSize();
      const longest = Math.max(size.width || 0, size.height || 0);
      if (longest > WALLPAPER_MAX_EDGE) {
        const scale = WALLPAPER_MAX_EDGE / longest;
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        });
      }
      const jpeg = image.toJPEG(WALLPAPER_JPEG_QUALITY);
      if (!jpeg || !jpeg.length) {
        throw new Error('图片压缩失败');
      }
      fs.writeFileSync(dest, jpeg);
    }

    try {
      for (const file of fs.readdirSync(dir)) {
        if (file === destName) continue;
        const isOverlay = /^overlay-wallpaper/i.test(file);
        const isMain = /^(custom|wallpaper)[-_.]/i.test(file) && !isOverlay;
        if ((kind === 'overlay' && isOverlay) || (kind !== 'overlay' && isMain)) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    return path.join('backgrounds', destName).replace(/\\/g, '/');
  }

  function loadBackgroundImagePayload(rel) {
    const normalized = safeBackgroundRel(rel);
    if (!normalized) {
      return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
    }
    const abs = path.isAbsolute(normalized) ? normalized : path.join(dataDir(), normalized);
    if (!path.isAbsolute(normalized)) {
      const root = path.resolve(dataDir()).toLowerCase();
      if (!path.resolve(abs).toLowerCase().startsWith(root)) {
        return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
      }
    }
    if (!fs.existsSync(abs)) {
      return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
    }
    try {
      const stat = fs.statSync(abs);
      const mtime = stat.mtimeMs;
      const protocolUrl = backgroundProtocolUrl(normalized);
      const cached = imageCache.get(abs);
      if (cached && cached.mtime === mtime && cached.protocolUrl) {
        return {
          backgroundImage: normalized,
          backgroundDataUrl: cached.dataUrl,
          backgroundFileUrl: cached.fileUrl,
          backgroundUrl: cached.protocolUrl
        };
      }

      const fileUrl = pathToFileURL(abs).href;
      let dataUrl = '';
      if (stat.size > 0 && stat.size <= WALLPAPER_INLINE_MAX_BYTES) {
        const data = fs.readFileSync(abs);
        dataUrl = `data:${mimeFromExt(path.extname(abs))};base64,${data.toString('base64')}`;
      }
      imageCache.set(abs, { mtime, dataUrl, fileUrl, protocolUrl });
      return {
        backgroundImage: normalized,
        backgroundDataUrl: dataUrl,
        backgroundFileUrl: fileUrl,
        backgroundUrl: protocolUrl
      };
    } catch (error) {
      if (log?.warn) log.warn('loadBackgroundImagePayload failed', error?.message || error);
      return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
    }
  }

  function clearImageCache() {
    imageCache.clear();
  }

  function cleanupWallpaperFiles(kind = 'main') {
    const dir = backgroundsDir();
    try {
      for (const file of fs.readdirSync(dir)) {
        const isOverlay = /^overlay-wallpaper/i.test(file);
        const isMain = /^(custom|wallpaper)/i.test(file) && !isOverlay;
        if ((kind === 'overlay' && isOverlay) || (kind !== 'overlay' && isMain)) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    backgroundsDir,
    importWallpaperImage,
    loadBackgroundImagePayload,
    clearImageCache,
    cleanupWallpaperFiles,
    WALLPAPER_INLINE_MAX_BYTES
  };
}

module.exports = {
  createWallpaperService,
  safeBackgroundRel,
  backgroundProtocolUrl,
  mimeFromExt,
  clampDim,
  clampBlur,
  clampFit,
  normalizeOverlayBgMode,
  stripAppearanceRuntimeFields,
  WALLPAPER_MAX_EDGE,
  WALLPAPER_JPEG_QUALITY,
  WALLPAPER_INLINE_MAX_BYTES
};

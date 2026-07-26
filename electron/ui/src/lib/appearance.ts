import type { AppearanceSettings } from '@/types/eco';

export const ACCENT_PRESETS = ['amber', 'teal', 'violet', 'rose', 'cyan', 'slate'] as const;
export const OVERLAY_BG_MODES = ['follow', 'solid', 'custom'] as const;

export type AccentId = (typeof ACCENT_PRESETS)[number];
export type OverlayBgMode = (typeof OVERLAY_BG_MODES)[number];

export function normalizeOverlayBgMode(raw: AppearanceSettings = {}): OverlayBgMode {
  const mode = String(raw.overlayBgMode || '').trim();
  if ((OVERLAY_BG_MODES as readonly string[]).includes(mode)) return mode as OverlayBgMode;
  return raw.applyToOverlay === false ? 'solid' : 'follow';
}

export function normalizeAppearance(raw: AppearanceSettings = {}): Required<
  Pick<
    AppearanceSettings,
    | 'backgroundImage'
    | 'backgroundDataUrl'
    | 'backgroundFileUrl'
    | 'backgroundUrl'
    | 'backgroundFit'
    | 'backgroundDim'
    | 'backgroundBlur'
    | 'overlayBgMode'
    | 'applyToOverlay'
    | 'overlayBackgroundImage'
    | 'overlayBackgroundUrl'
    | 'overlayBackgroundDataUrl'
    | 'overlayBackgroundFileUrl'
    | 'overlayBackgroundDim'
    | 'overlayBackgroundBlur'
    | 'overlayBackgroundFit'
    | 'accent'
  >
> {
  const dim = Number(raw.backgroundDim);
  const blur = Number(raw.backgroundBlur);
  const fit = String(raw.backgroundFit || 'cover');
  const accent = String(raw.accent || 'amber');
  const overlayDim = Number(raw.overlayBackgroundDim);
  const overlayBlur = Number(raw.overlayBackgroundBlur);
  const overlayFit = String(raw.overlayBackgroundFit || 'cover');
  const overlayBgMode = normalizeOverlayBgMode(raw);
  return {
    backgroundImage: String(raw.backgroundImage || '').trim(),
    backgroundDataUrl: String(raw.backgroundDataUrl || '').trim(),
    backgroundFileUrl: String(raw.backgroundFileUrl || '').trim(),
    backgroundUrl: String(raw.backgroundUrl || '').trim(),
    backgroundFit: ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover',
    backgroundDim: Number.isFinite(dim) ? Math.min(0.9, Math.max(0.1, dim)) : 0.52,
    backgroundBlur: Number.isFinite(blur) ? Math.min(24, Math.max(0, blur)) : 6,
    overlayBgMode,
    applyToOverlay: overlayBgMode !== 'solid',
    overlayBackgroundImage: String(raw.overlayBackgroundImage || '').trim(),
    overlayBackgroundUrl: String(raw.overlayBackgroundUrl || '').trim(),
    overlayBackgroundDataUrl: String(raw.overlayBackgroundDataUrl || '').trim(),
    overlayBackgroundFileUrl: String(raw.overlayBackgroundFileUrl || '').trim(),
    overlayBackgroundDim: Number.isFinite(overlayDim) ? Math.min(0.9, Math.max(0.1, overlayDim)) : 0.62,
    overlayBackgroundBlur: Number.isFinite(overlayBlur) ? Math.min(24, Math.max(0, overlayBlur)) : 4,
    overlayBackgroundFit: ['cover', 'contain', 'fill'].includes(overlayFit) ? overlayFit : 'cover',
    accent: (ACCENT_PRESETS as readonly string[]).includes(accent) ? accent : 'amber',
  };
}

export function wallpaperCssUrl(appearance: AppearanceSettings = {}) {
  const url = String(
    appearance.backgroundUrl
      || appearance.backgroundDataUrl
      || appearance.backgroundFileUrl
      || '',
  ).trim();
  if (!url) return 'none';
  return `url("${url.replace(/\\/g, '/').replace(/"/g, '\\"')}")`;
}

export function serializableAppearance(appearance: AppearanceSettings) {
  const normalized = normalizeAppearance(appearance);
  return {
    backgroundImage: normalized.backgroundImage || '',
    backgroundFit: normalized.backgroundFit,
    backgroundDim: normalized.backgroundDim,
    backgroundBlur: normalized.backgroundBlur,
    overlayBgMode: normalized.overlayBgMode,
    overlayBackgroundImage: normalized.overlayBackgroundImage || '',
    overlayBackgroundDim: normalized.overlayBackgroundDim,
    overlayBackgroundBlur: normalized.overlayBackgroundBlur,
    overlayBackgroundFit: normalized.overlayBackgroundFit,
    applyToOverlay: normalized.overlayBgMode !== 'solid',
    accent: normalized.accent,
  };
}

export function applyAppearanceToDocument(raw: AppearanceSettings = {}) {
  const appearance = normalizeAppearance(raw);
  const root = document.documentElement;
  const hasImage = Boolean(
    appearance.backgroundUrl
      || appearance.backgroundDataUrl
      || appearance.backgroundFileUrl
      || appearance.backgroundImage,
  );
  const imageValue = wallpaperCssUrl(appearance);
  root.dataset.accent = appearance.accent;
  root.style.setProperty('--bg-image', imageValue);
  root.style.setProperty('--bg-fit', appearance.backgroundFit === 'fill' ? '100% 100%' : appearance.backgroundFit);
  root.style.setProperty('--bg-dim', String(appearance.backgroundDim));
  root.style.setProperty('--bg-blur', `${appearance.backgroundBlur}px`);
  document.body.classList.toggle('has-wallpaper', hasImage);
  return appearance;
}

export function overlayBgModeHint(mode: string) {
  if (mode === 'solid') return '悬浮窗使用深色纯色底，不显示壁纸';
  if (mode === 'custom') return '使用单独选择的悬浮窗壁纸（可与主窗口不同）';
  return '使用主窗口壁纸，遮罩会略深以保证可读';
}

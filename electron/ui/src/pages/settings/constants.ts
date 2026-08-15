import { Palette, Languages, PictureInPicture2, Power, Download, Save } from 'lucide-react';
import type { AccentId } from '@/lib/appearance';

export const SETTINGS_TABS = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'translation', label: '翻译服务', icon: Languages },
  { id: 'overlay', label: '悬浮窗', icon: PictureInPicture2 },
  { id: 'startup', label: '启动行为', icon: Power },
  { id: 'data', label: '配置与预设', icon: Save },
  { id: 'updates', label: '软件更新', icon: Download },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const ACCENT_META: Record<AccentId, { title: string; desc: string }> = {
  amber: { title: '琥珀金', desc: '默认温暖强调' },
  teal: { title: '青绿', desc: '清爽辅助感' },
  violet: { title: '紫罗兰', desc: '偏夜间氛围' },
  rose: { title: '玫瑰粉', desc: '柔和对比' },
  cyan: { title: '青蓝', desc: '信息向冷色' },
  slate: { title: '石板灰', desc: '低饱和克制' },
};

export type TranslationFormState = {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  target_lang: string;
  source_lang: string;
  first_wait: number;
  player_names: string;
  toggle_hotkey: string;
  skip_hotkey: string;
  sync_enabled: boolean;
  sync_url: string;
  sync_token: string;
};

export type OverlayFormState = {
  visible: boolean;
  monitoring: boolean;
  scale: number;
  opacity: number;
  expiryWarningSeconds: number;
  density: string;
};

export type StartupFormState = {
  damage: boolean;
  monitoring: boolean;
  translator: boolean;
  overlay: boolean;
  tray: boolean;
  minimizeToTray: boolean;
  autoReconnect: boolean;
  prestartOnGame: boolean;
};

export type HotkeysFormState = {
  toggleOverlay: string;
  toggleWindow: string;
};

export type JobPreset = Record<string, unknown> & {
  id?: string | number;
  name?: string;
  note?: string;
};

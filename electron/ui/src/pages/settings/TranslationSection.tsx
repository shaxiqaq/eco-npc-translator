import { Eye, EyeOff, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TranslationFormState } from './constants';

type Props = {
  form: TranslationFormState;
  setForm: React.Dispatch<React.SetStateAction<TranslationFormState>>;
  showKey: boolean;
  setShowKey: React.Dispatch<React.SetStateAction<boolean>>;
  statusText: string;
  providerPreset: (provider: string) => { model: string; url: string } | null;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onSaved: () => void;
};

export function TranslationSection({
  form,
  setForm,
  showKey,
  setShowKey,
  statusText,
  providerPreset,
  onSave,
  onSaved,
}: Props) {
  return (
    <form
      className="settings-pane active"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          provider: form.provider,
          model: form.model.trim(),
          base_url: form.base_url.trim(),
          api_key: form.api_key.trim(),
          target_lang: form.target_lang,
          source_lang: form.source_lang || 'auto',
          first_wait: Number(form.first_wait || 0),
          player_names: form.player_names.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          toggle_hotkey: form.toggle_hotkey.trim(),
          skip_hotkey: form.skip_hotkey.trim(),
          sync_enabled: form.sync_enabled,
          sync_url: form.sync_url.trim(),
          sync_token: form.sync_token.trim(),
        }).then(onSaved);
      }}
    >
      <div className="settings-block">
        <div className="form-heading">
          <h2>翻译服务</h2>
          <p>NPC 对话翻译；推荐 DeepSeek + deepseek-chat（质量更好，可贡献共享词库）</p>
        </div>
        <div className="form-grid">
          <label>
            <span>服务商</span>
            <Select
              value={form.provider}
              onValueChange={(value) => {
                const preset = providerPreset(value);
                setForm((f) => ({
                  ...f,
                  provider: value,
                  model: preset?.model || f.model,
                  base_url: preset?.url ?? f.base_url,
                }));
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deepseek">DeepSeek（推荐）</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="ollama">本地 Ollama</SelectItem>
                <SelectItem value="deepl">DeepL</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>模型</span>
            <Input
              value={form.model}
              placeholder={form.provider === 'deepseek' ? 'deepseek-chat' : ''}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            />
          </label>
          <label className="wide">
            <span>接口地址</span>
            <Input value={form.base_url} onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))} />
          </label>
          <label className="wide">
            <span>API Key</span>
            <div className="password-field">
              <Input
                type={showKey ? 'text' : 'password'}
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </label>
          <label>
            <span>目标语言</span>
            <Select value={form.target_lang} onValueChange={(v) => setForm((f) => ({ ...f, target_lang: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="zh-TW">繁体中文</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>游戏原文</span>
            <Select value={form.source_lang || 'auto'} onValueChange={(v) => setForm((f) => ({ ...f, source_lang: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动识别（英/日/印尼）</SelectItem>
                <SelectItem value="en">英文</SelectItem>
                <SelectItem value="ja">日文</SelectItem>
                <SelectItem value="id">印尼文</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>首屏等待（秒）</span>
            <Input
              type="number"
              min={0}
              max={3}
              step={0.5}
              value={form.first_wait}
              onChange={(e) => setForm((f) => ({ ...f, first_wait: Number(e.target.value || 0) }))}
            />
            <span className="text-[11px] text-[var(--muted-foreground)]">
              0=第一次保持原文。建议 1.5–2 秒才够 API 返回；保存后必须重启 NPC 翻译。同一帧多段对话仍先原文，避免卡游戏。
            </span>
          </label>
          <label className="wide">
            <span>角色名</span>
            <Input
              value={form.player_names}
              placeholder="多个名称用逗号分隔"
              onChange={(e) => setForm((f) => ({ ...f, player_names: e.target.value }))}
            />
          </label>
          <label>
            <span>中/原文切换热键</span>
            <Input value={form.toggle_hotkey} onChange={(e) => setForm((f) => ({ ...f, toggle_hotkey: e.target.value }))} />
          </label>
          <label>
            <span>跳过对话热键</span>
            <Input value={form.skip_hotkey} onChange={(e) => setForm((f) => ({ ...f, skip_hotkey: e.target.value }))} />
          </label>
        </div>
        <div className="sub-settings">
          <label className="toggle-row">
            <div>
              <strong>共享词库</strong>
              <span>
                默认开启：拉取公共译文；上报仅接受可信模型（如 deepseek-chat）且通过脏文过滤的条目。本地 Ollama 等只写本机缓存。
              </span>
            </div>
            <Switch checked={form.sync_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, sync_enabled: v }))} />
          </label>
          <div className="form-grid sync-fields">
            <label className="wide">
              <span>节点地址</span>
              <Input value={form.sync_url} onChange={(e) => setForm((f) => ({ ...f, sync_url: e.target.value }))} />
            </label>
            <label className="wide">
              <span>访问口令</span>
              <Input type="password" value={form.sync_token} onChange={(e) => setForm((f) => ({ ...f, sync_token: e.target.value }))} />
            </label>
          </div>
        </div>
        <div className="form-actions">
          <span className="save-status">{statusText || ''}</span>
          <Button type="submit"><Save className="h-4 w-4" />保存翻译设置</Button>
        </div>
      </div>
    </form>
  );
}

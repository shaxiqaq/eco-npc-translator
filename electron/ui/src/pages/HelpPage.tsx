import { useEffect, useState } from 'react';
import { BookOpen, ClipboardCopy, ExternalLink, Keyboard, Shield } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageStack, SectionHeader } from '@/components/layout';

type AboutInfo = {
  version?: string;
  packaged?: boolean;
  electron?: string;
  hotkeys?: { toggleOverlay?: string; toggleWindow?: string };
  elevated?: boolean | null;
  rememberedTitles?: { main?: string | null; xiaoya?: string | null };
  errorCodes?: Record<string, { title?: string; hint?: string }>;
};

export function HelpPage() {
  const { copyDiagnostics, showToast, state } = useEco();
  const [about, setAbout] = useState<AboutInfo>({});

  useEffect(() => {
    void (async () => {
      if (!window.eco.getAbout) return;
      const result = await window.eco.getAbout();
      if (result?.ok && result.about) setAbout(result.about);
    })();
  }, [state.settings?.hotkeys, state.rememberedTitles]);

  const codes = Object.entries(about.errorCodes || {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <PageStack>
      <SectionHeader title="关于与排错" description="远程协助时可复制诊断；错误码便于搜索日志" />

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <BookOpen className="h-4 w-4 text-[var(--amber)]" />
              版本
            </div>
            <div className="text-[var(--muted-foreground)]">
              ECO 工具箱 <b className="text-[var(--text)]">{about.version || state.update?.currentVersion || '-'}</b>
              {about.packaged ? ' · 安装版' : ' · 开发模式'}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              Electron {about.electron || '-'}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Shield className="h-3.5 w-3.5" />
              管理员权限：
              {about.elevated === true ? '是' : about.elevated === false ? '否（挂接失败时可尝试提权）' : '未知'}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              记忆主号窗口：{about.rememberedTitles?.main || state.rememberedTitles?.main || '（无）'}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              记忆小雅窗口：{about.rememberedTitles?.xiaoya || state.rememberedTitles?.xiaoya || '（无）'}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  const result = await copyDiagnostics();
                  showToast(result.ok ? '诊断已复制' : result.error || '复制失败');
                }}
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                复制诊断
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void window.open('https://github.com/shaxiqaq/eco-npc-translator/releases', '_blank');
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Releases
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <Keyboard className="h-4 w-4 text-[var(--amber)]" />
              全局热键
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">可在「设置 → 启动行为」修改；留空禁用。</div>
            <ul className="m-0 list-none space-y-1.5 p-0 text-xs">
              <li>
                悬浮窗显示/隐藏：
                <code className="ml-1 rounded bg-black/20 px-1.5 py-0.5">
                  {about.hotkeys?.toggleOverlay || state.settings?.hotkeys?.toggleOverlay || '（未设置）'}
                </code>
              </li>
              <li>
                主窗口显示/隐藏：
                <code className="ml-1 rounded bg-black/20 px-1.5 py-0.5">
                  {about.hotkeys?.toggleWindow || state.settings?.hotkeys?.toggleWindow || '（未设置）'}
                </code>
              </li>
            </ul>
            <div className="pt-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
              关闭主窗口默认最小化到托盘；托盘菜单可彻底退出。进程掉线时可自动重连（设置可关）。
              进图后普攻一次即可识别角色。换号/采集异常时：总览点一次「换号识别」（会自动重连采集），
              再普攻一次即可。「清空统计」只清伤害数字，不会丢角色。
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="font-semibold">名称与 Wiki 数据来源</div>
          <ul className="m-0 list-disc space-y-1 pl-5 text-xs text-[var(--muted-foreground)]">
            <li>
              技能/怪物 ID 与中文表：客户端提取（
              <code>skill_names.json</code> / <code>mob_names.json</code>）
            </li>
            <li>
              日文技能名对照：
              <code>skill_names_ja.json</code>
              （客户端片假名 + Wiki 对齐种子名）
            </li>
            <li>
              状态分类与说明：
              <code>buff_names.json</code> + <code>buff_meta.json</code>
              ，机制说明参考{' '}
              <a className="text-[var(--amber)] underline" href="https://eco.lycolia.info/wiki/?StatusBuff" target="_blank" rel="noreferrer">
                StatusBuff
              </a>
            </li>
            <li>
              技能体系浏览：
              <a className="text-[var(--amber)] underline" href="https://eco.lycolia.info/wiki/?Skill" target="_blank" rel="noreferrer">
                Skill
              </a>
              {' · '}
              <a className="text-[var(--amber)] underline" href="https://eco.lycolia.info/wiki/?Job" target="_blank" rel="noreferrer">
                Job
              </a>
              {' · '}
              <a className="text-[var(--amber)] underline" href="https://eco.lycolia.info/wiki/?Partner" target="_blank" rel="noreferrer">
                Partner
              </a>
            </li>
            <li>Wiki 不提供精确 mask/skill_id；秒数以实战自定义倒计时为准。</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 text-sm font-semibold">错误码对照（ECO_Exx）</div>
          <div className="overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-[var(--muted-foreground)]">
                  <th className="px-2 py-2 font-medium">代码</th>
                  <th className="px-2 py-2 font-medium">含义</th>
                  <th className="px-2 py-2 font-medium">建议</th>
                </tr>
              </thead>
              <tbody>
                {codes.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-4 text-[var(--muted-foreground)]">
                      加载中…
                    </td>
                  </tr>
                ) : (
                  codes.map(([code, meta]) => (
                    <tr key={code} className="border-b border-[var(--line-soft)]">
                      <td className="px-2 py-2 font-mono font-semibold text-[var(--amber)]">{code}</td>
                      <td className="px-2 py-2">{meta.title}</td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">{meta.hint}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageStack>
  );
}

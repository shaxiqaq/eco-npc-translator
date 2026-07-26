import { EcoProvider, useEco } from '@/context/EcoContext';
import { AppShell } from '@/components/AppShell';
import { Toast } from '@/components/Toast';
import { UpdateDialog } from '@/components/UpdateDialog';
import { OnboardingDialog } from '@/components/OnboardingDialog';
import { OverviewPage } from '@/pages/OverviewPage';
import { DamagePage } from '@/pages/DamagePage';
import { BuffsPage } from '@/pages/BuffsPage';
import { TranslationPage } from '@/pages/TranslationPage';
import { XiaoyaPage } from '@/pages/XiaoyaPage';
import { LogsPage } from '@/pages/LogsPage';
import { SettingsPage } from '@/pages/SettingsPage';

function Pages() {
  const { page, ready } = useEco();
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
        正在加载 ECO 工具箱…
      </div>
    );
  }

  switch (page) {
    case 'damage':
      return <DamagePage />;
    case 'buffs':
      return <BuffsPage />;
    case 'translation':
      return <TranslationPage />;
    case 'xiaoya':
      return <XiaoyaPage />;
    case 'logs':
      return <LogsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'overview':
    default:
      return <OverviewPage />;
  }
}

export default function App() {
  return (
    <EcoProvider>
      <AppShell>
        <Pages />
      </AppShell>
      <Toast />
      <UpdateDialog />
      <OnboardingDialog />
    </EcoProvider>
  );
}

import { CircleCheck } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { cn } from '@/lib/utils';

export function Toast() {
  const { toast } = useEco();
  return (
    <div
      className={cn(
        'toast fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--surface)] px-3.5 py-2.5 text-xs shadow-[var(--shadow)] backdrop-blur-md transition-all',
        toast ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <CircleCheck className="h-4 w-4 text-[var(--green)]" />
      <span>{toast?.message || ''}</span>
    </div>
  );
}

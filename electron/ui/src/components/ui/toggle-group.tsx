import * as React from 'react';
import { cn } from '@/lib/utils';

type ToggleGroupContextValue = {
  value: string;
  onValueChange: (value: string) => void;
  fullWidth: boolean;
};

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(null);

export function ToggleGroup({
  value,
  onValueChange,
  className,
  children,
  fullWidth = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value: string;
  onValueChange: (value: string) => void;
  fullWidth?: boolean;
}) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange, fullWidth }}>
      <div
        role="group"
        className={cn(
          'rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-sm',
          fullWidth ? 'grid w-full grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1' : 'inline-flex h-9 items-center',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  value,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = React.useContext(ToggleGroupContext);
  if (!ctx) throw new Error('ToggleGroupItem must be used within ToggleGroup');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      data-state={active ? 'on' : 'off'}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 text-[12px] font-semibold transition-colors',
        ctx.fullWidth ? 'h-9 min-w-0' : 'h-8',
        active
          ? 'bg-[linear-gradient(135deg,var(--accent-soft),var(--accent-soft-2))] text-[var(--amber-hi)] shadow-[inset_0_0_0_1px_var(--accent-border)]'
          : 'bg-transparent text-[var(--muted-foreground)] hover:bg-white/[0.04] hover:text-[var(--foreground)]',
        className,
      )}
      onClick={() => ctx.onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--amber-hi)]',
        secondary: 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-foreground)]',
        skill: 'border-[rgba(242,184,75,0.35)] bg-[rgba(242,184,75,0.14)] text-[var(--amber-hi)]',
        normal: 'border-[var(--line)] bg-white/[0.04] text-[#e9eceb]',
        pet: 'border-[rgba(105,197,139,0.35)] bg-[rgba(105,197,139,0.14)] text-[var(--green)]',
        taken: 'border-[rgba(240,120,114,0.35)] bg-[rgba(240,120,114,0.14)] text-[var(--red)]',
        outline: 'border-[var(--line)] text-[var(--foreground)]',
        success: 'border-[rgba(105,197,139,0.35)] bg-[rgba(105,197,139,0.12)] text-[var(--green)]',
        warning: 'border-[var(--accent-border)] bg-[var(--accent-soft-2)] text-[var(--amber)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-xs font-semibold transition-[filter,transform,background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[linear-gradient(135deg,var(--amber-hi),var(--amber)_60%,var(--amber-lo))] text-[var(--primary-foreground)] shadow-[0_8px_18px_var(--accent-glow)] hover:brightness-105 hover:-translate-y-px active:translate-y-0 active:brightness-98',
        secondary:
          'border border-[var(--border)] bg-[var(--card)] text-[#ebe6f2] shadow-[var(--shadow)] backdrop-blur-md hover:border-[var(--accent-border)] hover:bg-[var(--surface-2)]',
        outline:
          'border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-2)] hover:border-[var(--accent-border)]',
        ghost:
          'border border-[var(--line-soft)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--border)] hover:bg-white/[0.04] hover:text-[var(--foreground)]',
        destructive:
          'border border-[rgba(240,120,114,0.28)] bg-[rgba(240,120,114,0.08)] text-[#f3b0ac] hover:border-[rgba(240,120,114,0.45)] hover:bg-[rgba(240,120,114,0.16)] hover:text-[#ffd0cd]',
        link: 'h-auto p-0 text-[var(--primary)] underline-offset-4 hover:underline hover:brightness-110',
      },
      size: {
        default: 'h-9 min-h-9 px-3.5',
        sm: 'h-8 min-h-8 rounded-md px-2.5 text-[11px] [&_svg]:size-4',
        lg: 'h-10 min-h-10 px-4 text-sm',
        icon: 'h-9 w-9 min-h-9 border border-[var(--border)] bg-[var(--surface-2)] text-[var(--foreground)] shadow-none hover:border-[var(--primary)] hover:text-[var(--primary)]',
        'icon-sm': 'h-8 w-8 min-h-8 border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--primary)] hover:text-[var(--primary)] [&_svg]:size-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

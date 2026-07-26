import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-[var(--shadow)] backdrop-blur-md',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-[var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,.03),transparent)] px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-semibold leading-none tracking-wide text-[var(--foreground)]', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[11px] leading-relaxed text-[var(--muted-foreground)]', className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-[var(--line-soft)] px-4 py-3', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };

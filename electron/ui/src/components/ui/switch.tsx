import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--primary)] data-[state=unchecked]:bg-[#3b4247]',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-3.5 w-3.5 rounded-full shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[3px] data-[state=checked]:bg-[var(--primary-foreground)] data-[state=unchecked]:bg-[#d9ddde]',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

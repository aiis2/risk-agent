import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = 'right',
  align = 'center',
  delayDuration = 300,
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={clsx(
            'z-50 rounded-md px-2.5 py-1.5 text-xs font-medium',
            'border border-border bg-surface-soft text-text',
            'shadow-lg shadow-black/25',
            'animate-in fade-in-0 zoom-in-95',
            'data-[side=right]:slide-in-from-left-1',
            'data-[side=left]:slide-in-from-right-1',
            'data-[side=top]:slide-in-from-bottom-1',
            'data-[side=bottom]:slide-in-from-top-1',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-soft" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

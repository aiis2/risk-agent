import * as SelectPrimitive from '@radix-ui/react-select';
import { IconCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { clsx } from 'clsx';

export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  disabled?: boolean;
  children: React.ReactNode;
  placeholder?: string;
  className?: string;
}

export function Select({ value, onValueChange, defaultValue, disabled, children, placeholder, className }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue} disabled={disabled}>
      <SelectTrigger className={className} placeholder={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </SelectPrimitive.Root>
  );
}

interface SelectTriggerProps extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  placeholder?: string;
}

export function SelectTrigger({ className, children, placeholder: _placeholder, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={clsx(
        'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-border',
        'bg-surface-input px-3 py-1.5 text-sm text-text',
        'placeholder:text-text-muted',
        'focus:bg-surface-soft focus:outline-none focus:border-accent/50',
        'hover:border-border-strong transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[placeholder]:text-text-muted',
        '[&>span]:truncate [&>span]:text-left',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <IconChevronDown size={12} className="shrink-0 text-text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={clsx(
          'relative z-50 min-w-[8rem] overflow-hidden rounded-lg border border-border',
          'bg-surface-dialog shadow-xl shadow-black/30',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' && [
            'data-[side=bottom]:translate-y-1',
            'data-[side=left]:-translate-x-1',
            'data-[side=right]:translate-x-1',
            'data-[side=top]:-translate-y-1',
          ],
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={clsx(
            'p-1',
            position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={clsx('px-2.5 py-1.5 text-xs font-semibold text-text-muted', className)}
      {...props}
    />
  );
}

export function SelectItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={clsx(
        'relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2.5 text-sm text-text',
        'outline-none',
        'hover:bg-surface-soft focus:bg-surface-soft',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <IconCheck size={12} className="text-accent" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={clsx('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

function SelectScrollUpButton({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={clsx('flex cursor-default items-center justify-center py-1 text-text-muted', className)}
      {...props}
    >
      <IconChevronUp size={12} />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={clsx('flex cursor-default items-center justify-center py-1 text-text-muted', className)}
      {...props}
    >
      <IconChevronDown size={12} />
    </SelectPrimitive.ScrollDownButton>
  );
}

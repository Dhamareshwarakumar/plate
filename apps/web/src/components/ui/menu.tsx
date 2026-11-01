import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface MenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}

/** Overflow (⋯) menu. Items are `MenuItem`s; use `MenuSeparator` between groups. */
export function Menu({ trigger, children, align = 'end' }: MenuProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="bg-surface border-border animate-menu-in z-50 min-w-48 rounded-control border p-1 shadow-xl"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function MenuItem({
  children,
  icon,
  onSelect,
  destructive = false,
  disabled = false,
}: MenuItemProps) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-10 cursor-default select-none items-center gap-2.5 rounded-[0.5rem] px-2.5 text-sm outline-none',
        'data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50',
        destructive ? 'text-danger' : 'text-fg',
      )}
    >
      {icon ? <span className="text-fg-muted [&>svg]:size-4">{icon}</span> : null}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="bg-border my-1 h-px" />;
}

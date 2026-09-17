import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn.js';
import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Sheet root — thin wrapper around Radix Dialog for side-drawer UX. */
export function Sheet({ open, onOpenChange, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog.Root>
  );
}

interface SheetContentProps {
  children: ReactNode;
  className?: string;
}

/**
 * Sheet panel — slides in from the right.
 * Radix Dialog handles: Escape-to-close, focus trapping, role="dialog",
 * aria-modal, and background scroll lock automatically.
 */
export function SheetContent({ children, className }: SheetContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <Dialog.Content
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          'duration-300 ease-in-out',
          'flex flex-col',
          className,
        )}
      >
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

/** Sheet title — satisfies Radix's required accessible title. */
export function SheetTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Title className={cn('text-lg font-semibold', className)}>
      {children}
    </Dialog.Title>
  );
}

/** Sheet close button trigger. */
export function SheetClose({ children }: { children: ReactNode }) {
  return <Dialog.Close asChild>{children}</Dialog.Close>;
}

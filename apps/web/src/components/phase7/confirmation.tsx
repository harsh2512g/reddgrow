'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@threadsignal/ui';

/** Native dialog provides focus containment, Escape handling, and focus restoration. */
export function BillingConfirmation({
  open,
  title,
  busy,
  children,
  onClose,
  onConfirm,
  confirmLabel,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="billing-confirmation-title"
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-[26px] border border-border bg-white p-6 text-foreground shadow-xl backdrop:bg-[#1d223b]/40 sm:p-8"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="billing-confirmation-title" className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close confirmation"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <div className="my-6 space-y-4 text-sm leading-7 text-muted-foreground">{children}</div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Keep current plan
        </Button>
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? 'Updating plan…' : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

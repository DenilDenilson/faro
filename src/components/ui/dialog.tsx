import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className="dialog-content"
          onOpenAutoFocus={(event) => {
            const target = event.currentTarget as HTMLElement | null;
            if (target) target.scrollTop = 0;
          }}
        >
          <div className="dialog-header">
            <div>
              <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description
                className={description ? 'dialog-description muted' : 'sr-only'}
              >
                {description ?? 'Consulta o modifica este registro de FARO.'}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar diálogo">
                <X size={19} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDelete({
  name,
  open,
  onOpenChange,
  onConfirm,
  busy,
  error,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy: boolean;
  error?: string;
}) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="dialog-overlay" />
        <AlertPrimitive.Content className="dialog-content" style={{ maxWidth: 460 }}>
          <AlertPrimitive.Title className="dialog-title">Eliminar «{name}»</AlertPrimitive.Title>
          <AlertPrimitive.Description className="muted">
            Esta acción no se puede deshacer. Si el registro tiene relaciones, FARO puede solicitar
            que lo archives para conservar el historial.
          </AlertPrimitive.Description>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <AlertPrimitive.Cancel asChild>
              <Button variant="secondary" disabled={busy}>
                Conservar
              </Button>
            </AlertPrimitive.Cancel>
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {busy ? 'Eliminando…' : 'Sí, eliminar'}
            </Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}

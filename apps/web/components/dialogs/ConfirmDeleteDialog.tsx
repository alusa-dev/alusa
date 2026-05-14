'use client';
import { useId, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * ConfirmDeleteDialog
 * Acessibilidade e consistência visual:
 * - Título em DialogTitle
 * - Descrição com tipografia neutra e alto contraste suficiente
 * - Área de ações alinhada à direita com espaçamento consistente (gap-2 / pt-4)
 * - Botão primário em variante destructive; secundário outline
 */
export interface ConfirmDeleteDialogProps {
  open: boolean;
  title?: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onOpenChange: (_open: boolean) => void;
  children?: ReactNode;
  /** Se true (default), layout em coluna; agora sem ícone de alerta */
  centered?: boolean;
}

export function ConfirmDeleteDialog({
  open,
  title = 'Confirmar exclusão',
  description,
  confirmLabel = 'Excluir',
  cancelLabel = 'Cancelar',
  loadingLabel = 'Excluindo...',
  destructive = true,
  onConfirm,
  onOpenChange,
  children,
  centered = true,
}: ConfirmDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const descriptionId = useId();

  const palette = destructive
    ? {
        iconWrap: 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-100',
        confirmButton:
          'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500',
      }
    : {
        iconWrap: 'bg-[#F5ECFF] text-[#6B21FF] ring-1 ring-inset ring-[#E4D2FF]',
        confirmButton:
          'bg-[#7A1BFF] text-white shadow-sm hover:bg-[#6B1DF2] focus-visible:ring-[#7A1BFF]',
      };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) onOpenChange(false);
      }}
    >
      <DialogContent
        className="relative w-[calc(100vw-2rem)] max-w-[430px] gap-0 overflow-hidden rounded-[26px] border border-slate-200/90 bg-white p-0 shadow-2xl shadow-black/10 sm:w-full"
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="space-y-6 px-6 pb-6 pt-6 sm:px-7 sm:pb-7 sm:pt-7">
          {centered ? (
            <div className="flex flex-col gap-4">
              <div className="space-y-3 text-left">
                {title && (
                  <DialogTitle className="text-lg font-semibold leading-tight text-slate-900">
                    {title}
                  </DialogTitle>
                )}
                <DialogDescription
                  id={description ? descriptionId : undefined}
                  className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap"
                >
                  {description}
                </DialogDescription>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="space-y-3 text-left">
                {title && (
                  <DialogTitle className="text-lg font-semibold leading-tight text-slate-900">
                    {title}
                  </DialogTitle>
                )}
                <DialogDescription
                  id={description ? descriptionId : undefined}
                  className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap"
                >
                  {description}
                </DialogDescription>
              </div>
            </div>
          )}
          {children ? (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-left shadow-inner">
              <div className="space-y-3 text-sm text-slate-600">{children}</div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-200/90 bg-slate-50/70 px-6 py-5 sm:px-7">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => !loading && onOpenChange(false)}
            className="min-w-[128px] border-slate-200 text-slate-600 shadow-none hover:bg-slate-100"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={loading}
            onClick={async () => {
              try {
                setLoading(true);
                await onConfirm();
                onOpenChange(false);
              } finally {
                setLoading(false);
              }
            }}
            className={`min-w-[140px] ${palette.confirmButton}`}
          >
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDeleteDialog;

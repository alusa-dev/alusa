"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  usuarioId: string | null;
  usuarioNome?: string;
  onSaved?: () => void;
};

export default function UsuarioEditDialog({ open, onOpenChange, usuarioId, usuarioNome, onSaved }: Props) {
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setName(usuarioNome || "");
  }, [open, usuarioNome]);

  async function onConfirm() {
    if (!usuarioId) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error("Informe um nome válido (mín. 2 caracteres)");
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch(`/api/users/${encodeURIComponent(usuarioId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data?.error?.message || data?.error || "Erro ao salvar") as string);
        return;
      }
      toast.success("Usuário atualizado");
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error("Erro de comunicação");
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenMobile
        className="max-w-md gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
      >
        <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">Editar usuário</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-600">
            Atualize o nome exibido para este usuário na equipe.
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
          <div className="flex-1 space-y-4 px-4 py-5 md:px-6">
            <div>
              <label htmlFor="nome" className="mb-1 block text-xs text-gray-600">
                Nome
              </label>
              <Input
                id="nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome completo"
                className="h-11 md:h-10"
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 min-h-11 w-full border border-slate-300 bg-white text-slate-700 shadow-none hover:bg-slate-50 md:h-10 md:min-h-0 md:w-auto"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className="h-11 min-h-11 w-full bg-violet-600 text-white hover:bg-violet-700 md:h-10 md:min-h-0 md:w-auto"
            >
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

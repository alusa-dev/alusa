"use client";
import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
      <DialogContent title="Editar usuário" className="max-w-md">
        <div className="space-y-4">
          <div>
            <label htmlFor="nome" className="block text-xs text-gray-600 mb-1">Nome</label>
            <Input id="nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="bg-white text-slate-700 border border-slate-300 hover:bg-slate-50" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
            <Button type="button" onClick={onConfirm} disabled={submitting} className="bg-violet-600 hover:bg-violet-700 text-white">{submitting ? "Salvando..." : "Salvar"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

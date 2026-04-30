"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Edit, Plus, Refresh } from "@/components/icons/icons";
import type { CentroCustoDTO } from "@/features/financeiro/centros-custo/dtos";

type Centro = CentroCustoDTO;
type CentroTipo = FormState["tipo"];
type CentroStatus = FormState["status"];
type FilterTipo = CentroTipo | "TODOS";
type FilterStatus = CentroStatus | "TODOS";

type FormState = {
  id?: string;
  nome: string;
  tipo: "RECEITA" | "DESPESA" | "MISTO";
  descricao: string;
  status: "ATIVO" | "INATIVO";
};

const emptyForm: FormState = {
  nome: "",
  tipo: "MISTO",
  descricao: "",
  status: "ATIVO",
};

const FILTER_TIPOS = ["TODOS", "RECEITA", "DESPESA", "MISTO"] as const;
const FILTER_STATUS = ["TODOS", "ATIVO", "INATIVO"] as const;
const CENTRO_TIPOS = ["RECEITA", "DESPESA", "MISTO"] as const;
const CENTRO_STATUS = ["ATIVO", "INATIVO"] as const;

const isFilterTipo = (value: string): value is FilterTipo =>
  FILTER_TIPOS.includes(value as FilterTipo);
const isFilterStatus = (value: string): value is FilterStatus =>
  FILTER_STATUS.includes(value as FilterStatus);
const isCentroTipo = (value: string): value is CentroTipo =>
  CENTRO_TIPOS.includes(value as CentroTipo);
const isCentroStatus = (value: string): value is CentroStatus =>
  CENTRO_STATUS.includes(value as CentroStatus);

export default function CentrosCustoPage() {
  const [centros, setCentros] = useState<Centro[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("ATIVO");
  const [filterTipo, setFilterTipo] = useState<FilterTipo>("TODOS");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTipo !== "TODOS") params.set("tipo", filterTipo);
      if (filterStatus !== "TODOS") params.set("status", filterStatus);
      const res = await fetch(`/api/financeiro/centros-custo?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "Falha ao carregar centros de custo");
      setCentros(json.data || []);
    } catch (err) {
      toast.error((err as Error).message);
      setCentros([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterTipo]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return centros;
  }, [centros]);

  const openCreate = () => {
    setForm(emptyForm);
    setModalOpen(true);
  };
  const openEdit = (c: Centro) => {
    setForm({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      descricao: c.descricao || "",
      status: c.status,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) {
      toast.error("Informe o nome");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: form.nome,
        tipo: form.tipo,
        descricao: form.descricao.trim() || null,
        status: form.status,
      };
      const res = await fetch(
        form.id ? `/api/financeiro/centros-custo/${form.id}` : "/api/financeiro/centros-custo",
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "Falha ao salvar centro de custo");
      toast.success(form.id ? "Centro atualizado" : "Centro criado");
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (centro: Centro, status: "ATIVO" | "INATIVO") => {
    try {
      const res = await fetch(`/api/financeiro/centros-custo/${centro.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "Falha ao alterar status");
      toast.success(`Centro ${status === "ATIVO" ? "ativado" : "inativado"}`);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDelete = async (centro: Centro) => {
    if (!confirm("Deseja excluir este centro de custo? Ele deve não ter lançamentos associados.")) return;
    try {
      const res = await fetch(`/api/financeiro/centros-custo/${centro.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "Falha ao excluir centro de custo");
      toast.success("Centro excluído");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-[22px] md:text-[24px] font-semibold text-gray-900">Centros de Custo</h1>
          <p className="text-[13px] text-gray-500">Gerencie centros por tipo, status e acompanhe lançamentos vinculados.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="centro-refresh">
            <Refresh className="h-4 w-4 mr-2" /> Atualizar
          </Button>
          <Button onClick={openCreate} data-testid="centro-novo">
            <Plus className="h-4 w-4 mr-2" /> Novo centro
          </Button>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select
            value={filterTipo}
            onValueChange={(value) => {
              if (isFilterTipo(value)) setFilterTipo(value);
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="RECEITA">Receita</SelectItem>
              <SelectItem value="DESPESA">Despesa</SelectItem>
              <SelectItem value="MISTO">Misto</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filterStatus}
            onValueChange={(value) => {
              if (isFilterStatus(value)) setFilterStatus(value);
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="ATIVO">Ativo</SelectItem>
              <SelectItem value="INATIVO">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Nome</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Tipo</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Lançamentos</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-gray-500">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                    Nenhum centro encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} data-testid="centro-row">
                  <td className="px-3 py-2 font-medium text-gray-900">{c.nome}</td>
                  <td className="px-3 py-2 text-gray-700">{c.tipo}</td>
                  <td className="px-3 py-2">
                    <Badge status={c.status === "ATIVO" ? "ATIVO" : "INATIVO"}>
                      {c.status === "ATIVO" ? "Ativo" : "Inativo"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{c._count?.lancamentos ?? 0}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid="centro-editar">
                      <Edit className="h-4 w-4 mr-1" /> Editar
                    </Button>
                    {c.status === "ATIVO" ? (
                      <Button size="sm" variant="outline" onClick={() => toggleStatus(c, "INATIVO")} data-testid="centro-inativar">
                        Inativar
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => toggleStatus(c, "ATIVO")} data-testid="centro-ativar">
                        Ativar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(c)}
                      disabled={(c._count?.lancamentos ?? 0) > 0}
                      data-testid="centro-excluir"
                    >
                      Excluir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar centro de custo" : "Novo centro de custo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nome</label>
              <Input value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} data-testid="centro-nome" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Tipo</label>
              <Select
                value={form.tipo}
                onValueChange={(value) => {
                  if (isCentroTipo(value)) {
                    setForm((prev) => ({ ...prev, tipo: value }));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MISTO">Misto</SelectItem>
                  <SelectItem value="RECEITA">Receita</SelectItem>
                  <SelectItem value="DESPESA">Despesa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Descrição</label>
              <Textarea rows={3} value={form.descricao} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))} />
            </div>
            {form.id && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={form.status}
                  onValueChange={(value) => {
                    if (isCentroStatus(value)) {
                      setForm((prev) => ({ ...prev, status: value }));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ATIVO">Ativo</SelectItem>
                    <SelectItem value="INATIVO">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="centro-salvar">
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

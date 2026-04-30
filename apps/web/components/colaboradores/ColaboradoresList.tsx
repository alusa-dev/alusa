'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit,
  Trash,
} from '@/components/icons/icons';
import ColaboradorEditDialog from './ColaboradorEditDialog';
import ColaboradorDeleteDialog from './ColaboradorDeleteDialog';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { useSession } from 'next-auth/react';
// Evita que o TypeScript inclua o diálogo no programa. Tipagem mínima local.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type WizardProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onFinish?: () => void;
  contaId?: string;
};
const ColaboradorWizardDialog = dynamic<WizardProps>(
  () =>
    import('./ColaboradorWizardDialog') as unknown as Promise<{
      default: ComponentType<WizardProps>;
    }>,
  { ssr: false },
);

type Colaborador = {
  id: string;
  nome: string;
  email: string | null;
  telefone1?: string | null;
  status: 'ATIVO' | 'INATIVO' | string;
  createdAt?: string;
  updatedAt?: string;
};

export default function ColaboradoresList() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Colaborador[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'ATIVO' | 'INATIVO'>('TODOS');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [current, setCurrent] = useState<Colaborador | null>(null);
  const { data: session } = useSession();
  const effectiveContaId =
    (session?.user as { contaId?: string } | undefined)?.contaId || 'conta-default';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('contaId', effectiveContaId);
      if (searchTerm.trim()) params.set('q', searchTerm.trim());
      if (statusFilter !== 'TODOS') params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/colaboradores?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      const arr = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.data)
          ? data.data
          : [];
      setItems(arr);
      if (typeof data?.total === 'number') setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [effectiveContaId, page, pageSize, searchTerm, statusFilter]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const onChanged = () => {
      load();
    };
    window.addEventListener('colaboradores:changed', onChanged as EventListener);
    return () => window.removeEventListener('colaboradores:changed', onChanged as EventListener);
  }, [load]);

  // Como a API já retorna página ordenada e filtrada, mantemos items diretamente
  const ordered = useMemo(
    () =>
      [...items].sort((a, b) =>
        (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }),
      ),
    [items],
  );

  // Debounce: reconsultar quando filtros mudarem
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1); // reset página ao alterar filtros
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    load();
  }, [page, load]);

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
            Gestão de Colaboradores
          </h1>
          <p className="text-[13px] text-gray-500">
            Gerencie cadastros e informações dos colaboradores.
          </p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <Button
                  className="bg-brand-accent hover:bg-brand-accent/90 text-white"
                  onClick={() => setCreateOpen(true)}
                  data-testid="add-colaborador"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar Colaborador
                </Button>
              </div>
            </div>

            <div className="flex w-full md:w-auto items-center gap-3">
              <div>
                <Button
                  variant="outline"
                  className="bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filtro
                </Button>
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="TODOS">Todos os status</SelectItem>
                  <SelectItem value="ATIVO">Ativo</SelectItem>
                  <SelectItem value="INATIVO">Inativo</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative flex-1 md:w-[320px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por nome ou email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          {loading ? (
            <>
              <div className="bg-gray-50 px-6 py-3 border-b">
                <div className="grid grid-cols-12 gap-4">
                  <Skeleton className="col-span-4 h-4" />
                  <Skeleton className="col-span-3 h-4" />
                  <Skeleton className="col-span-3 h-4" />
                  <Skeleton className="col-span-1 h-4" />
                  <Skeleton className="col-span-1 h-4" />
                </div>
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-6 py-3">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <Skeleton className="col-span-4 h-4 w-48" />
                    <Skeleton className="col-span-3 h-4 w-56" />
                    <Skeleton className="col-span-3 h-4 w-32" />
                    <Skeleton className="col-span-1 h-6 w-12 rounded-full" />
                    <Skeleton className="col-span-1 h-8 w-8 rounded-md justify-self-end" />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="bg-gray-50 px-6 py-3 border-b">
                <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                  <div className="col-span-4">Nome</div>
                  <div className="col-span-3 text-center">E-mail</div>
                  <div className="col-span-3 text-center">Telefone</div>
                  <div className="col-span-1 text-center">Status</div>
                  <div className="col-span-1 text-center">Ações</div>
                </div>
              </div>
              <div className="divide-y">
                {ordered.length === 0 ? (
                  <div className="px-6 py-12 text-center text-gray-500">
                    Nenhum colaborador encontrado
                  </div>
                ) : (
                  ordered.map((c) => (
                    <div
                      key={c.id}
                      className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white"
                    >
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-4 text-[13px] text-gray-900">{c.nome}</div>
                        <div
                          className="col-span-3 text-[13px] text-gray-700 text-center truncate"
                          title={c.email || ''}
                        >
                          {c.email || '-'}
                        </div>
                        <div className="col-span-3 text-[13px] text-gray-700 text-center">
                          {c.telefone1 || '-'}
                        </div>
                        <div className="col-span-1 flex justify-center">
                          <Badge status={c.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />
                        </div>
                        <div className="col-span-1 flex justify-center gap-1">
                          <button
                            aria-label="Editar"
                            className="h-8 w-8 grid place-items-center rounded-md border bg-white text-gray-700 hover:bg-gray-50"
                            onClick={() => {
                              setCurrent(c);
                              setEditOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            aria-label="Excluir"
                            className="h-8 w-8 grid place-items-center rounded-md border bg-white text-red-600 hover:bg-red-50"
                            onClick={() => {
                              setCurrent(c);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {total > 0 && (
          <div className="flex items-center justify-center py-6">
            <div className="flex items-center gap-2 text-sm">
              <button
                aria-label="Primeira página"
                className="h-8 w-8 rounded-md border grid place-items-center border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                aria-label="Página anterior"
                className="h-8 w-8 rounded-md border grid place-items-center border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-brand-accent/70">
                Página {page} de {Math.max(1, Math.ceil(total / pageSize))}
              </span>
              <button
                aria-label="Próxima página"
                className="h-8 w-8 rounded-md border grid place-items-center border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / pageSize)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                aria-label="Última página"
                className="h-8 w-8 rounded-md border grid place-items-center border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent"
                onClick={() => setPage(Math.ceil(total / pageSize))}
                disabled={page >= Math.ceil(total / pageSize)}
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      <ColaboradorEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        colaborador={
          current
            ? {
                id: current.id,
                nome: current.nome,
                email: current.email,
                telefone1: current.telefone1,
                status: current.status as 'ATIVO' | 'INATIVO' | undefined,
              }
            : null
        }
        contaId={effectiveContaId}
        onSaved={() => load()}
      />
      <ColaboradorDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        colaboradorId={current?.id ?? null}
        colaboradorNome={current?.nome}
        onDeleted={() => load()}
      />
      <ColaboradorWizardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onFinish={() => load()}
        contaId={effectiveContaId}
      />
    </>
  );
}

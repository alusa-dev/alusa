'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { Loader2, Plus, Search, Tag, Trash2 } from 'lucide-react';

import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { TableLayout } from '@/components/layout/TableLayout';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

import {
  createCategory,
  deleteCategory,
  listCategories,
  type CategoryDTO,
} from './services/categories-service';

export function CategoriasFeature() {
  const [items, setItems] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // create
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // delete
  const [toDelete, setToDelete] = useState<CategoryDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await listCategories();
      setItems(data);
    } catch (err) {
      toast.error({ title: 'Erro ao carregar categorias', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCategory(name);
      setItems((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setCreateOpen(false);
      toast.success({ title: 'Categoria criada', description: `"${created.name}" adicionada com sucesso.` });
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteCategory(toDelete.id);
      setItems((prev) => prev.filter((c) => c.id !== toDelete.id));
      toast.success({ title: 'Categoria removida', description: `"${toDelete.name}" foi excluída.` });
      setToDelete(null);
    } catch (err) {
      toast.error({ title: 'Não foi possível excluir', description: (err as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  const filtered = deferredSearch.trim()
    ? items.filter((c) => c.name.toLowerCase().includes(deferredSearch.toLowerCase()))
    : items;

  const columns: DataTableColumn<CategoryDTO>[] = [
    {
      id: 'name',
      header: 'Nome',
      width: 'w-full',
      align: 'left',
      skeleton: (
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-gray-100" />
          <div className="h-4 w-40 rounded bg-gray-200" />
        </div>
      ),
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A94DFF]/10">
            <Tag className="size-4 text-[#A94DFF]" />
          </div>
          <span className="text-sm font-medium text-slate-800">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Criada em',
      width: 'w-[180px]',
      align: 'left',
      noWrap: true,
      skeleton: <div className="h-4 w-28 rounded bg-gray-200" />,
      render: (row) => (
        <span className="text-sm text-slate-500">
          {new Date(row.createdAt).toLocaleDateString('pt-BR')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      width: 'w-[60px]',
      align: 'right',
      skeleton: <div className="h-7 w-7 rounded-lg bg-gray-100 ml-auto" />,
      render: (row) => (
        <div className="flex justify-end">
          <button
            type="button"
            title="Excluir categoria"
            onClick={() => setToDelete(row)}
            className="flex size-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <TableLayout
        title="Categorias"
        subtitle="Organize seus produtos por categoria para facilitar a gestão e as vendas."
        actions={
          <Button
            className="h-10 bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90"
            onClick={() => { setCreateError(null); setCreateOpen(true); }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova categoria
          </Button>
        }
        filtersBar={
          <div className="relative min-w-0 w-full sm:w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Buscar categoria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-xl border-slate-200 bg-white pl-10 shadow-none"
            />
          </div>
        }
      >
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Categorias cadastradas</h2>
              <p className="mt-1 text-xs text-slate-500">
                Clique no ícone de lixeira para excluir. Categorias com produtos ativos não podem ser removidas.
              </p>
            </div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {filtered.length} registro(s)
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            rowKey={(row) => row.id}
            loading={loading}
            skeletonRows={6}
            ariaLabel="Tabela de categorias"
            bodyClassName="[&_td]:py-4"
            emptyMessage={
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <Tag className="size-8 opacity-40" />
                <p className="text-sm">
                  {search.trim() ? 'Nenhuma categoria encontrada.' : 'Nenhuma categoria cadastrada ainda.'}
                </p>
              </div>
            }
          />
        </div>
      </TableLayout>

      {/* Dialog criar */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}>
        <DialogContent
          fullScreenMobile
          className="gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 sm:max-w-[400px] md:rounded-2xl"
        >
          <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] sm:px-6 sm:py-5">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 sm:pr-0">
              Nova categoria
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-slate-600">
              Insira o nome da categoria. Ele deve ser único dentro da sua conta.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4 max-md:min-h-0 sm:px-6 sm:py-5">
              <Input
                autoFocus
                placeholder="Ex.: Roupas, Acessórios..."
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setCreateError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
                disabled={creating}
              />
              {createError && (
                <p className="text-xs font-medium text-red-600">{createError}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full border-slate-200 bg-white shadow-none hover:bg-slate-100 sm:h-10 sm:min-h-0 sm:w-auto"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 sm:h-10 sm:min-h-0 sm:w-auto sm:min-w-[120px]"
                onClick={() => void handleCreate()}
                disabled={creating || !newName.trim()}
              >
                {creating ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Criar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar exclusão */}
      <Dialog open={!!toDelete} onOpenChange={(open) => { if (!deleting && !open) setToDelete(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Excluir categoria</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-slate-800">&ldquo;{toDelete?.name}&rdquo;</span>?
              Categorias com produtos ativos não podem ser excluídas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

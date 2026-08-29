'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, {
  type SortOrder,
  type StatusValue,
} from '@/components/layout/EntityFiltersBar';
import Pagination from '@/components/layout/Pagination';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Archive,
  ArchiveRestore,
  Edit3,
  MoreVertical,
  Package2,
  Plus,
} from '@/components/icons/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import useCurrentUser from '@/hooks/use-current-user';
import { useProducts } from './hooks/use-products';
import { type ProductListItem } from './services/products-service';
import { usePlatformBillingWriteAccess } from '@/hooks/use-platform-billing-write-access';

const PAGE_SIZE = 20;

type ProductViewMode = 'catalog' | 'archived';

function getProductReference(product: ProductListItem) {
  const sku = product.sku?.trim();

  if (sku) {
    return { label: 'SKU', value: sku };
  }

  return {
    label: 'ID',
    value: product.id.slice(0, 8).toUpperCase(),
  };
}

interface ProdutosTableProps {
  products: ProductListItem[];
  loading: boolean;
  searchTerm: string;
  viewMode: ProductViewMode;
  pendingIds: Set<string>;
  canWrite: boolean;
  onEdit: (_product: ProductListItem) => void;
  onDelete: (_product: ProductListItem) => void;
  onToggleStatus: (_product: ProductListItem, _active: boolean) => void;
  onRestore: (_product: ProductListItem) => void;
}

function ProdutosTable({
  products,
  loading,
  searchTerm,
  viewMode,
  pendingIds,
  canWrite,
  onEdit,
  onDelete,
  onToggleStatus,
  onRestore,
}: ProdutosTableProps) {
  const actionColumn = {
    id: 'actions',
    header: 'Ações',
    width: 'w-[4rem] max-lg:shrink-0 lg:w-[8%]',
    align: 'right',
    headerClassName: 'px-3 md:px-6',
    cellClassName: 'px-3 md:px-6',
    skeleton: <div className="ml-auto size-8 rounded-lg bg-gray-200" />,
    render: (row: ProductListItem) => {
      const isPending = pendingIds.has(row.id);

      if (viewMode === 'archived') {
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                  aria-label={`Abrir ações de ${row.name}`}
                  disabled={isPending || !canWrite}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => onRestore(row)}>
                  <ArchiveRestore className="mr-2 size-4" />
                  Restaurar produto
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      }

      return (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                aria-label={`Abrir ações de ${row.name}`}
                disabled={isPending || !canWrite}
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onEdit(row)}>
                <Edit3 className="mr-2 size-4" />
                Editar produto
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-amber-700 hover:text-amber-800 data-[highlighted]:text-amber-800"
                disabled={isPending}
                onSelect={() => onDelete(row)}
              >
                <Archive className="mr-2 size-4" />
                Arquivar produto
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  } satisfies DataTableColumn<ProductListItem>;

  const columns: DataTableColumn<ProductListItem>[] = [
    {
      id: 'name',
      header: 'Produto',
      width: 'min-w-0 lg:w-[32%]',
      align: 'left',
      noWrap: false,
      skeleton: (
        <div className="flex items-center gap-3">
          <div className="size-14 rounded-xl bg-gray-100" />
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
        </div>
      ),
      render: (row) => {
        const reference = getProductReference(row);
        const effectiveStock = row.totalStock;

        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
              {row.primaryImageUrl ? (
                <img
                  src={row.primaryImageUrl}
                  alt={row.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package2 className="h-6 w-6 text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium leading-tight text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                {row.name}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">
                {reference.label}: {reference.value}
              </div>
              <div className="mt-1.5 space-y-0.5 lg:hidden text-[11px] text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                {row.category?.name ? <div className="truncate">{row.category.name}</div> : null}
                <div>{row.hasVariants ? `${row.variantGroupCount} variantes` : 'Sem variantes'}</div>
                <div>{effectiveStock} un. em estoque</div>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'category',
      header: 'Categoria',
      width: 'lg:w-[17%]',
      align: 'left',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: <div className="h-4 w-28 rounded bg-gray-200" />,
      render: (row) => (
        <div className="min-w-0">
          {row.category?.name ? (
            <span className="block truncate text-sm text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">{row.category.name}</span>
          ) : (
            <span className="text-sm text-slate-300 alusa-dark:text-[color:var(--color-text-muted)]">—</span>
          )}
        </div>
      ),
    },
    {
      id: 'variants',
      header: 'Variantes',
      width: 'lg:w-[15%]',
      align: 'left',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: <div className="h-4 w-20 rounded bg-gray-200" />,
      render: (row) => (
        <span className="text-sm text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
          {row.hasVariants ? `${row.variantGroupCount} variantes` : 'Sem variantes'}
        </span>
      ),
    },
    {
      id: 'stock',
      header: 'Estoque',
      width: 'lg:w-[20%]',
      align: 'left',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: (
        <div className="h-4 w-20 rounded bg-gray-100" />
      ),
      render: (row) => {
        const effectiveStock = row.totalStock;

        return (
          <span
            className="text-sm font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]"
            aria-label={`${effectiveStock} unidade(s) em estoque`}
          >
            {effectiveStock} unidades
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-[4.5rem] max-lg:shrink-0 lg:w-[8%]',
      align: 'center',
      headerClassName: 'max-lg:px-1',
      cellClassName: 'max-lg:px-1',
      skeleton: <div className="mx-auto h-5 w-9 rounded-full bg-gray-200" />,
      render: (row) => {
        const isPending = pendingIds.has(row.id);

        if (viewMode === 'archived') {
          return (
            <div className="flex justify-center">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]">
                Arquivado
              </span>
            </div>
          );
        }

        return (
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.isActive}
              disabled={isPending || !canWrite}
              aria-label={
                row.isActive ? `Inativar produto ${row.name}` : `Ativar produto ${row.name}`
              }
              onCheckedChange={(active) => onToggleStatus(row, active)}
              className="h-5 w-10"
              thumbClassName="h-4 w-4 data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-5"
            />
          </div>
        );
      },
    },
    actionColumn,
  ];

  return (
    <DataTable
      columns={columns}
      data={products}
      rowKey={(row) => row.id}
      loading={loading}
      skeletonRows={8}
      ariaLabel="Tabela de produtos"
      onRowClick={viewMode === 'catalog' && canWrite ? onEdit : undefined}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500 text-sm alusa-dark:text-[color:var(--color-text-secondary)]">
          {searchTerm
            ? 'Nenhum produto encontrado para esta busca.'
            : viewMode === 'archived'
              ? 'Nenhum produto arquivado.'
              : 'Nenhum produto cadastrado. Clique em "Novo produto" para começar.'}
        </div>
      }
    />
  );
}

export function ProdutosFeature() {
  const { canWrite, loading: billingLoading } = usePlatformBillingWriteAccess();
  const router = useRouter();
  const { user: _user } = useCurrentUser();

  const { items, loading, meta, reload, remove, restore, toggleActive } = useProducts();

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ProductViewMode>('catalog');

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');
  const [statusFilter, setStatusFilter] = useState<StatusValue>('TODOS');
  const [page, setPage] = useState(1);

  async function handleToggleStatus(product: ProductListItem, active: boolean) {
    if (pendingIds.has(product.id)) return;
    setPendingIds((prev) => new Set(prev).add(product.id));
    try {
      await toggleActive(product.id, active);
    } catch (err) {
      toast.error((err as Error).message ?? 'Não foi possível alterar o status do produto.');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  }

  async function handleRestoreProduct(product: ProductListItem) {
    if (pendingIds.has(product.id)) return;
    setPendingIds((prev) => new Set(prev).add(product.id));
    try {
      await restore(product.id);
      toast.success(`Produto "${product.name}" restaurado`);
      void reload({ search: searchTerm, page, pageSize: PAGE_SIZE, archived: true });
    } catch (err) {
      toast.error((err as Error).message ?? 'Não foi possível restaurar o produto.');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  }

  const deleteDialog = useDeleteDialog<ProductListItem>({
    onDelete: async (product) => {
      await remove(product.id);
    },
  });

  useEffect(() => {
    void reload({
      search: searchTerm,
      page,
      pageSize: PAGE_SIZE,
      archived: viewMode === 'archived',
    });
  }, [searchTerm, page, reload, viewMode]);

  function handleEdit(product: ProductListItem) {
    if (!canWrite) return;
    router.push(`/vendas/produtos/${product.id}/editar`);
  }

  const filtered = useMemo(
    () =>
      items.filter((product) => {
        if (viewMode === 'archived') return true;
        if (statusFilter === 'ATIVO') return product.isActive;
        if (statusFilter === 'INATIVO') return !product.isActive;
        return true;
      }),
    [items, statusFilter, viewMode],
  );

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return sortOrder === 'ASC' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });

  const totalPages = Math.ceil(meta.total / PAGE_SIZE);
  const viewTabs = (
    <Tabs
      value={viewMode}
      onValueChange={(value) => {
        setViewMode(value as ProductViewMode);
        setPage(1);
        setStatusFilter('TODOS');
      }}
    >
      <TabsList className="h-10 rounded-lg bg-slate-100/80 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
        <TabsTrigger value="catalog" className="h-8 rounded-md px-4 text-sm shadow-none alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:data-[state=active]:bg-[color:var(--color-bg-elevated)] alusa-dark:data-[state=active]:text-[color:var(--color-text-primary)]">
          Catálogo
        </TabsTrigger>
        <TabsTrigger value="archived" className="h-8 rounded-md px-4 text-sm shadow-none alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:data-[state=active]:bg-[color:var(--color-bg-elevated)] alusa-dark:data-[state=active]:text-[color:var(--color-text-primary)]">
          Arquivados
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return (
    <>
      <TableLayout
        title="Produtos"
        subtitle="Gerencie os produtos disponíveis para venda."
        actions={
          <Button
            onClick={() => router.push('/vendas/produtos/novo')}
            disabled={billingLoading || !canWrite}
            className="h-10 w-full rounded-lg bg-primary px-4 text-white shadow-none hover:bg-primary/90 lg:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo produto
          </Button>
        }
        filtersBar={
          <EntityFiltersBar
            searchValue={searchTerm}
            onSearchChange={(v) => {
              setSearchTerm(v);
              setPage(1);
            }}
            searchPlaceholder={
              viewMode === 'archived' ? 'Buscar arquivado...' : 'Buscar produto...'
            }
            statusValue={statusFilter}
            onStatusChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            hideStatusFilter={viewMode === 'archived'}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            extraLeft={viewTabs}
          />
        }
        footer={
          totalPages > 1 ? (
            <Pagination page={page} total={meta.total} pageSize={PAGE_SIZE} onChange={setPage} />
          ) : null
        }
      >
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
          <ProdutosTable
            products={sorted}
            loading={loading}
            searchTerm={searchTerm}
            viewMode={viewMode}
            pendingIds={pendingIds}
            canWrite={canWrite}
            onEdit={handleEdit}
            onDelete={(product) => deleteDialog.openDialog(product)}
            onToggleStatus={handleToggleStatus}
            onRestore={handleRestoreProduct}
          />
        </div>
      </TableLayout>

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title="Arquivar produto"
        description={`Deseja arquivar o produto "${deleteDialog.entity?.name}"? Ele não aparecerá mais na listagem, mas poderá ser restaurado.`}
        onConfirm={deleteDialog.confirm}
        confirmLabel="Arquivar"
      />
    </>
  );
}

export default ProdutosFeature;

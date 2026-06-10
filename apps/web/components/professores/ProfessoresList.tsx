'use client';
import EditEntityDialog from '@/components/dialogs/EditEntityDialog';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import EntityFiltersBar, {
  type StatusValue,
  type SortOrder,
} from '@/components/layout/EntityFiltersBar';
import TableLayout from '@/components/layout/TableLayout';
import Pagination from '@/components/layout/Pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Edit3, Trash2 } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, useMemo } from 'react';

type Professor = {
  id: string;
  nome: string;
  email: string | null;
  telefoneCel?: string | null;
  status: 'ATIVO' | 'INATIVO' | string;
  createdAt: string;
  updatedAt: string;
};

export default function ProfessoresList() {
  // substitui implementação antiga por versão padronizada
  const { data: session } = useSession();
  const contaId = (session?.user as { contaId?: string } | undefined)?.contaId;
  const [data, setData] = useState<Professor[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusValue>('TODOS');
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const [editing, setEditing] = useState<Professor | null>(null);
  const [deleting, setDeleting] = useState<Professor | null>(null);

  const load = useCallback(async () => {
    if (!contaId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('contaId', contaId);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/professores?${params.toString()}`);
      const json = await res.json();
      const arr = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.items)
          ? json.items
          : [];
      setData(arr);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [q, contaId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('professores:changed', h);
    return () => window.removeEventListener('professores:changed', h);
  }, [load]);

  const ordered = useMemo(
    () =>
      [...data]
        .filter((p) => (statusFilter === 'TODOS' ? true : p.status === statusFilter))
        .filter((p) => {
          if (!q.trim()) return true;
          const term = q.toLowerCase();
          return (
            (p.nome || '').toLowerCase().includes(term) ||
            (p.email || '').toLowerCase().includes(term)
          );
        })
        .sort((a, b) =>
          (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }),
        ),
    [data, statusFilter, q],
  );
  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, sortOrder]);
  const paginated = ordered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <TableLayout
      title="Professores"
      subtitle="Gerencie cadastros e informações dos professores."
      actions={
        <Button
          disabled={!contaId}
          className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
        >
          <Plus className="h-4 w-4 mr-2" /> Novo professor
        </Button>
      }
      filtersBar={
        <EntityFiltersBar
          searchValue={q}
          onSearchChange={setQ}
          onSearchEnter={load}
          statusValue={statusFilter}
          onStatusChange={setStatusFilter}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          searchPlaceholder="Buscar por nome ou email..."
        />
      }
    >
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
                  <Skeleton className="col-span-4 h-4" />
                  <Skeleton className="col-span-3 h-4" />
                  <Skeleton className="col-span-3 h-4" />
                  <Skeleton className="col-span-1 h-6 w-12" />
                  <Skeleton className="col-span-1 h-8 w-8" />
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
              {paginated.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhum professor encontrado
                </div>
              ) : (
                paginated.map((p) => (
                  <div key={p.id} className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4 text-[13px] text-gray-900 truncate">{p.nome}</div>
                      <div
                        className="col-span-3 text-[13px] text-gray-700 text-center truncate"
                        title={p.email || ''}
                      >
                        {p.email || '-'}
                      </div>
                      <div className="col-span-3 text-[13px] text-gray-700 text-center">
                        {p.telefoneCel || '-'}
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <Badge status={p.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />
                      </div>
                      <div className="col-span-1 flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                          aria-label="Editar professor"
                          onClick={() => setEditing(p)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                          aria-label="Excluir professor"
                          onClick={() => setDeleting(p)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
        {ordered.length > pageSize ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
            <Pagination total={ordered.length} page={page} pageSize={pageSize} onChange={setPage} />
          </div>
        ) : null}
      </div>
      {editing && (
        <EditEntityDialog
          open={!!editing}
          title="Editar professor"
          description="Atualize os dados do professor."
          fields={[
            {
              name: 'nome',
              label: 'Nome',
              initialValue: editing.nome,
              validate: (v) => (!v.trim() ? 'Informe o nome' : null),
            },
            { name: 'email', label: 'E-mail', initialValue: editing.email || '' },
            { name: 'telefoneCel', label: 'Telefone', initialValue: editing.telefoneCel || '' },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              initialValue: editing.status === 'ATIVO' ? 'ATIVO' : 'INATIVO',
              options: [
                { value: 'ATIVO', label: 'Ativo' },
                { value: 'INATIVO', label: 'Inativo' },
              ],
            },
          ]}
          onBuildPayload={(raw) => ({
            contaId,
            nome: String(raw.nome).trim(),
            email: String(raw.email || '').trim() || null,
            telefoneCel: String(raw.telefoneCel || '').trim() || null,
            status: raw.status,
          })}
          onSubmit={async (payload) => {
            try {
              const res = await fetch(`/api/professores/${editing.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const j = await res.json().catch(() => null);
              if (!res.ok) throw new Error(j?.error?.message || 'Falha ao salvar');
              toast.custom((t) => (
                <CustomToast
                  variant="success"
                  title="Professor atualizado"
                  description="Alterações salvas."
                  onClose={() => toast.dismiss(t)}
                />
              ));
              setEditing(null);
              load();
              window.dispatchEvent(new CustomEvent('professores:changed'));
            } catch (e) {
              toast.custom((t) => (
                <CustomToast
                  variant="error"
                  title="Erro ao salvar"
                  description={(e as Error).message}
                  onClose={() => toast.dismiss(t)}
                />
              ));
            }
          }}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          open={!!deleting}
          title="Excluir professor"
          description={(() => {
            const raw = String(deleting.nome || '').trim();
            const parts = raw.split(/\s+/);
            const first = parts[0];
            const last = parts.length > 1 ? parts[parts.length - 1] : '';
            const display =
              last && last.toLowerCase() !== first.toLowerCase() ? `${first} ${last}` : first;
            return (
              <span>
                Tem certeza que deseja excluir o professor <strong>{display}</strong>? Esta ação não
                pode ser desfeita.
              </span>
            );
          })()}
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/professores/${deleting.id}?contaId=${contaId}`, {
                method: 'DELETE',
              });
              if (!res.ok) {
                const j = await res.json().catch(() => null);
                throw new Error(j?.error?.message || 'Falha ao excluir');
              }
              toast.custom((t) => (
                <CustomToast
                  variant="success"
                  title="Professor excluído"
                  description="O professor foi removido."
                  onClose={() => toast.dismiss(t)}
                />
              ));
              setDeleting(null);
              load();
              window.dispatchEvent(new CustomEvent('professores:changed'));
            } catch (e) {
              toast.custom((t) => (
                <CustomToast
                  variant="error"
                  title="Erro ao excluir"
                  description={(e as Error).message}
                  onClose={() => toast.dismiss(t)}
                />
              ));
            }
          }}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        />
      )}
    </TableLayout>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { TableLayout } from '@/components/layout/TableLayout';
import {
  PlusIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { Eye } from '@/components/icons/icons';
import { useModelos } from './hooks/use-modelos';
import { Badge } from '@/components/ui/badge';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import type { ContratoModelo } from './services/modelos-service';

export function ModelosContratoFeature() {
  const router = useRouter();
  const { modelos, loading, remove } = useModelos();
  const [deleteTarget, setDeleteTarget] = useState<ContratoModelo | null>(null);

  const columns: DataTableColumn<ContratoModelo>[] = useMemo(
    () => [
      {
        id: 'nome',
        header: 'Nome do Modelo',
        align: 'left',
        width: 'w-2/5', // ~40%
        render: (m) => (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-brand-primary/5 rounded-lg flex items-center justify-center shrink-0">
              <DocumentTextIcon className="h-5 w-5 text-brand-primary" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-gray-900 truncate">
                {m.nome}
              </span>
              {m.descricao && (
                <span className="text-sm text-gray-500 truncate">
                  {m.descricao}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        id: 'versao',
        header: 'Versão',
        align: 'center',
        width: 'w-1/12', // ~8.33%
        render: (m) => (
          <Badge variant="neutral" size="sm" className="font-mono">
            v{m.versao}
          </Badge>
        ),
      },
      {
        id: 'uso',
        header: 'Contratos Gerados',
        align: 'center',
        width: 'w-1/6', // ~16.66%
        render: (m) => (
          <span className="text-gray-600 text-sm font-medium">
            {m._count?.contratos || 0}
          </span>
        ),
      },
      statusColumn<ContratoModelo>({}),
      actionsColumn<ContratoModelo>({
        onEdit: (m) => router.push(`/contratos/modelos/${m.id}`),
        onDelete: (m) => setDeleteTarget(m),
        editIcon: <Eye className="h-4 w-4" />,
        editButtonAriaLabel: (m) => `Visualizar modelo ${m.nome}`,
        deleteButtonAriaLabel: (m) => `Excluir modelo ${m.nome}`,
      }),
    ],
    [router]
  );

  return (
    <TableLayout
      title="Modelos de Contrato"
      subtitle="Gerencie os modelos de contrato disponíveis para sua instituição"
      actions={
        <Button onClick={() => router.push('/contratos/modelos/importar')}>
          <PlusIcon className="h-4 w-4 mr-2" />
          Importar Contrato
        </Button>
      }
    >
      <div className="bg-white rounded-xl border overflow-hidden">
        <DataTable<ContratoModelo>
          data={modelos}
          columns={columns}
          rowKey={(m) => m.id}
          loading={loading}
          emptyMessage="Nenhum modelo de contrato encontrado."
          onRowClick={(m) => router.push(`/contratos/modelos/${m.id}`)}
        />
      </div>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await remove(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        title="Excluir modelo de contrato"
        description={`Tem certeza que deseja excluir o modelo "${deleteTarget?.nome}"? ${
          (deleteTarget?._count?.contratos ?? 0) > 0
            ? 'Este modelo possui contratos vinculados e será apenas inativado.'
            : 'Esta ação não pode ser desfeita.'
        }`}
      />
    </TableLayout>
  );
}

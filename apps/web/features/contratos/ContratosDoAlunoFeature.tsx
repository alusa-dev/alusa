'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { TableLayout } from '@/components/layout/TableLayout';
import { Eye, Trash, ArrowPrev } from '@/components/icons/icons';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';
import {
  cancelContrato as cancelContratoService,
  getContratosByAluno,
  type Contrato,
} from './services/contratos-service';
import { Badge, type StatusType } from '@/components/ui/badge';

interface ContratosDoAlunoFeatureProps {
  alunoId: string;
}

export function ContratosDoAlunoFeature({ alunoId }: ContratosDoAlunoFeatureProps) {
  const router = useRouter();
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Contrato | null>(null);

  useEffect(() => {
    setLoading(true);
    getContratosByAluno(alunoId)
      .then((data) => setContratos(Array.isArray(data) ? data : []))
      .catch((err) => {
        toast.error((err as Error).message);
        setContratos([]);
      })
      .finally(() => setLoading(false));
  }, [alunoId]);

  const alunoNome = contratos[0]?.matricula?.aluno?.nome ?? null;

  const columns: DataTableColumn<Contrato>[] = useMemo(
    () => [
      {
        id: 'tipo',
        header: 'Tipo',
        align: 'left',
        render: (c) => <div className="text-sm text-gray-600">{c.modelo?.nome || 'Personalizado'}</div>,
      },
      {
        id: 'turma',
        header: 'Turma',
        align: 'left',
        render: (c) => <div className="text-sm text-gray-600">{c.matricula.turma?.nome || 'Sem turma'}</div>,
      },
      {
        id: 'status',
        header: 'Status',
        align: 'center',
        width: 'w-[130px]',
        render: (c) => <Badge status={c.status as StatusType} size="sm" />,
      },
      {
        id: 'criadoEm',
        header: 'Gerado em',
        align: 'center',
        width: 'w-[120px]',
        render: (c) => (
          <span className="text-gray-500 text-xs">
            {new Date(c.createdAt).toLocaleDateString('pt-BR')}
          </span>
        ),
      },
      {
        id: 'acoes',
        header: 'Ações',
        align: 'right',
        width: 'w-[120px]',
        render: (c) => (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(`/contratos/${c.id}`)}
              title="Ver detalhes"
            >
              <Eye className="h-4 w-4 text-gray-500" />
            </Button>
            {c.status === 'PENDENTE' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCancelTarget(c)}
                title="Cancelar"
                className="text-red-500 hover:text-red-600 hover:bg-red-50"
              >
                <Trash className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [router],
  );

  async function handleCancel() {
    if (!cancelTarget) return;
    try {
      await cancelContratoService(cancelTarget.id);
      toast.success('Contrato cancelado com sucesso');
      setContratos((prev) => prev.map((c) => (c.id === cancelTarget.id ? { ...c, status: 'CANCELADO' } : c)));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <TableLayout
      title={alunoNome ? `Contratos de ${alunoNome}` : 'Contratos do aluno'}
      subtitle="Veja e gerencie os contratos vinculados a este aluno."
      actions={
        <Button variant="outline" onClick={() => router.push('/contratos')} className="h-10 px-4">
          <ArrowPrev className="h-4 w-4 mr-2" />
          Voltar
        </Button>
      }
    >
      <div className="bg-white rounded-xl border overflow-hidden">
        <DataTable
          data={contratos}
          columns={columns}
          loading={loading}
          rowKey={(row) => row.id}
          emptyMessage="Nenhum contrato encontrado para este aluno."
        />
      </div>

      <ConfirmDeleteDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancelar Contrato"
        description="Tem certeza que deseja cancelar este contrato? O link de assinatura será invalidado."
        onConfirm={handleCancel}
        loadingLabel="Cancelando..."
        confirmLabel="Cancelar Contrato"
        destructive
      />
    </TableLayout>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { TableLayout } from '@/components/layout/TableLayout';
import { Eye, Trash, ArrowPrev } from '@/components/icons/icons';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';
import { Badge, type StatusType } from '@/components/ui/badge';
import {
  cancelContrato as cancelContratoService,
  getContratosByAluno,
  type Contrato,
} from './services/contratos-service';

interface ContratosDoAlunoFeatureProps {
  alunoId: string;
}

function contratoTipoTurmaLine(c: Contrato): string {
  const tipo = c.modelo?.nome || 'Personalizado';
  const turma = c.matricula.turma?.nome;
  return turma ? `${tipo} · ${turma}` : tipo;
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
        render: (c) => (
          <div className="flex justify-center">
            <Badge status={c.status as StatusType} size="sm" />
          </div>
        ),
      },
      {
        id: 'criadoEm',
        header: 'Gerado em',
        align: 'center',
        width: 'w-[120px]',
        render: (c) => (
          <span className="text-xs text-gray-500">
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
                className="text-red-500 hover:bg-red-50 hover:text-red-600"
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
      className="w-full min-w-0"
      title={alunoNome ? `Contratos de ${alunoNome}` : 'Contratos do aluno'}
      subtitle="Veja e gerencie os contratos vinculados a este aluno."
      actions={
        <Button variant="outline" onClick={() => router.push('/contratos')} className="h-10 px-4">
          <ArrowPrev className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl border bg-white lg:hidden">
        {loading ? (
          <ul className="m-0 divide-y divide-gray-100 p-0">
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-4 py-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
                <div className="mt-2 h-3 w-24 animate-pulse rounded bg-gray-100" />
              </li>
            ))}
          </ul>
        ) : contratos.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Nenhum contrato encontrado para este aluno.
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-100 p-0" role="list">
            {contratos.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] font-semibold leading-snug text-gray-900">
                    {contratoTipoTurmaLine(c)}
                  </p>
                  <p className="text-xs tabular-nums text-gray-500">
                    Gerado em {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                  <Badge
                    status={c.status as StatusType}
                    size="sm"
                    className="w-fit max-w-full whitespace-normal leading-tight"
                  />
                </div>
                <div className="flex shrink-0 items-start">
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => router.push(`/contratos/${c.id}`)}
                      title="Ver detalhes"
                    >
                      <Eye className="h-4 w-4 text-gray-500" />
                    </Button>
                    {c.status === 'PENDENTE' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setCancelTarget(c)}
                        title="Cancelar"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-white lg:block">
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

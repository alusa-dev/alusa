'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { TableLayout } from '@/components/layout/TableLayout';
import { Eye, Trash, ArrowPrev } from '@/components/icons/icons';
import ActionConfirmationDialog from '@/components/dialogs/ActionConfirmationDialog';
import { toast } from '@/components/ui/toast';
import { Badge, type StatusType } from '@/components/ui/badge';
import {
  cancelContract as cancelContratoService,
  getContractsByStudent,
  getEventContractsByStudent,
  type ContractEvent,
  type Contract,
} from './services/contracts-service';

interface StudentContractsFeatureProps {
  alunoId: string;
}

type ContractListItem = {
  id: string;
  nome: string;
  tipo: 'Matrícula' | 'Evento';
  contexto: string;
  status: string;
  createdAt: string;
  detalhePath: string;
  podeCancelar: boolean;
  contratoMatricula?: Contract;
};

export function StudentContractsFeature({ alunoId }: StudentContractsFeatureProps) {
  const router = useRouter();
  const [contratos, setContratos] = useState<Contract[]>([]);
  const [eventContracts, setEventContracts] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Contract | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getContractsByStudent(alunoId), getEventContractsByStudent(alunoId)])
      .then(([academic, event]) => {
        setContratos(Array.isArray(academic) ? academic : []);
        setEventContracts(Array.isArray(event) ? event : []);
      })
      .catch((err) => {
        toast.error((err as Error).message);
        setContratos([]);
        setEventContracts([]);
      })
      .finally(() => setLoading(false));
  }, [alunoId]);

  const alunoNome = contratos[0]?.matricula?.aluno?.nome ?? eventContracts[0]?.aluno?.nome ?? null;

  const listaContratos = useMemo<ContractListItem[]>(
    () => [
      ...contratos.map((contrato) => ({
        id: contrato.id,
        nome: contrato.modelo?.nome || 'Contrato personalizado',
        tipo: 'Matrícula' as const,
        contexto: contrato.matricula.turma?.nome || 'Sem turma',
        status: contrato.status,
        createdAt: contrato.createdAt,
        detalhePath: `/contracts/${contrato.id}`,
        podeCancelar: contrato.status === 'PENDENTE',
        contratoMatricula: contrato,
      })),
      ...eventContracts.map((contrato) => ({
        id: contrato.id,
        nome: contrato.modelo?.nome || 'Contrato do evento',
        tipo: 'Evento' as const,
        contexto: contrato.evento?.name || 'Evento indisponível',
        status: contrato.status,
        createdAt: contrato.createdAt,
        detalhePath: `/contracts/event/${contrato.id}`,
        podeCancelar: false,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [contratos, eventContracts],
  );

  const columns: DataTableColumn<ContractListItem>[] = useMemo(
    () => [
      {
        id: 'nome',
        header: 'Nome',
        align: 'left',
        render: (item) => <div className="text-sm text-gray-600">{item.nome}</div>,
      },
      {
        id: 'tipo',
        header: 'Tipo',
        align: 'left',
        width: 'w-[120px]',
        render: (item) => <div className="text-sm text-gray-600">{item.tipo}</div>,
      },
      {
        id: 'contexto',
        header: 'Turma / Evento',
        align: 'left',
        render: (item) => <div className="text-sm text-gray-600">{item.contexto}</div>,
      },
      {
        id: 'criadoEm',
        header: 'Gerado em',
        align: 'center',
        width: 'w-[120px]',
        headerClassName: 'whitespace-nowrap',
        render: (item) => (
          <span className="text-xs text-gray-500">
            {new Date(item.createdAt).toLocaleDateString('pt-BR')}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        align: 'center',
        width: 'w-[130px]',
        render: (item) => <Badge status={item.status as StatusType} size="sm" />,
      },
      {
        id: 'acoes',
        header: 'Ações',
        align: 'right',
        width: 'w-[120px]',
        render: (item) => (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(item.detalhePath)}
              title="Ver detalhes"
            >
              <Eye className="h-4 w-4 text-gray-500" />
            </Button>
            {item.podeCancelar && item.contratoMatricula && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCancelTarget(item.contratoMatricula!)}
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
        <Button variant="outline" onClick={() => router.push('/contracts')} className="h-10 px-4">
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
        ) : listaContratos.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Nenhum contrato encontrado para este aluno.
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-100 p-0" role="list">
            {listaContratos.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] font-semibold leading-snug text-gray-900">{item.nome}</p>
                  <p className="text-xs text-gray-500">{item.tipo} · {item.contexto}</p>
                  <p className="text-xs tabular-nums text-gray-500">
                    Gerado em {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                  <Badge status={item.status as StatusType} size="sm" className="w-fit max-w-full whitespace-normal leading-tight" />
                </div>
                <div className="flex shrink-0 items-start">
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => router.push(item.detalhePath)}
                      title="Ver detalhes"
                    >
                      <Eye className="h-4 w-4 text-gray-500" />
                    </Button>
                    {item.podeCancelar && item.contratoMatricula ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setCancelTarget(item.contratoMatricula!)}
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
          data={listaContratos}
          columns={columns}
          loading={loading}
          rowKey={(row) => row.id}
          emptyMessage="Nenhum contrato encontrado para este aluno."
        />
      </div>

      <ActionConfirmationDialog
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

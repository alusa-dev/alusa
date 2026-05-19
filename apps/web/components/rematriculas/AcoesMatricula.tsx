'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { pushToast } from '@/components/ui/toast';
import { ActionDialog } from './ActionDialog';
import { DangerActionDialog } from './DangerActionDialog';
import { PausarMatriculaDialog, type PausarMatriculaPayload } from './PausarMatriculaDialog';
import { ReativarMatriculaDialog, type ReativarMatriculaPayload } from './ReativarMatriculaDialog';
import { StatusMatricula } from '@prisma/client';
import { PlayIcon, PauseIcon, XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';

interface AcoesMatriculaProps {
  matricula: {
    id: string;
    status: StatusMatricula;
    vencimentoDia?: number;
    aluno: {
      nome: string;
    };
  };
  onRefresh: () => void;
  onNavigateToList: () => void;
}

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';

type ApiErrorPayload = {
  error?: string | {
    code?: string;
    message?: string;
    details?: {
      providerMessage?: string;
      blockedBy?: {
        cobrancas?: number;
        cobrancasPorStatus?: Record<string, number>;
        pagamentos?: number;
        subscriptions?: number;
        installmentPlans?: number;
        contratoComAceite?: number;
      };
    } | null;
  };
  message?: string;
  details?: {
    providerMessage?: string;
    blockedBy?: {
      cobrancas?: number;
      cobrancasPorStatus?: Record<string, number>;
      pagamentos?: number;
      subscriptions?: number;
      installmentPlans?: number;
      contratoComAceite?: number;
    };
  } | null;
};

type BlockedByDetails = {
  cobrancas?: number;
  cobrancasPorStatus?: Record<string, number>;
  pagamentos?: number;
  subscriptions?: number;
  installmentPlans?: number;
  contratoComAceite?: number;
};

function getErrorCode(payload: ApiErrorPayload): string | null {
  if (typeof payload.error === 'string') {
    return payload.error;
  }

  return payload.error?.code ?? null;
}

function getBlockedByDetails(payload: ApiErrorPayload): BlockedByDetails | undefined {
  if (payload.details?.blockedBy) {
    return payload.details.blockedBy;
  }

  if (typeof payload.error === 'object' && payload.error?.details?.blockedBy) {
    return payload.error.details.blockedBy;
  }

  return undefined;
}

function buildHardDeleteBlockedMessage(blockedBy?: BlockedByDetails) {
  if (!blockedBy) {
    return 'A exclusão permanente foi bloqueada porque a matrícula já possui histórico relevante.';
  }

  const parts: string[] = [];
  const cobrancasAbertas =
    (blockedBy.cobrancasPorStatus?.PENDENTE ?? 0) +
    (blockedBy.cobrancasPorStatus?.A_VENCER ?? 0) +
    (blockedBy.cobrancasPorStatus?.ATRASADO ?? 0) +
    (blockedBy.cobrancasPorStatus?.PROCESSANDO ?? 0);

  if (cobrancasAbertas > 0) parts.push(`${cobrancasAbertas} cobrança(s) aberta(s)`);
  if ((blockedBy.cobrancasPorStatus?.PAGO ?? 0) > 0) parts.push(`${blockedBy.cobrancasPorStatus?.PAGO} cobrança(s) paga(s)`);
  if ((blockedBy.pagamentos ?? 0) > 0) parts.push(`${blockedBy.pagamentos} pagamento(s)`);
  if ((blockedBy.subscriptions ?? 0) > 0) parts.push(`${blockedBy.subscriptions} assinatura(s)`);
  if ((blockedBy.installmentPlans ?? 0) > 0) parts.push(`${blockedBy.installmentPlans} parcelamento(s)`);
  if ((blockedBy.contratoComAceite ?? 0) > 0) parts.push(`${blockedBy.contratoComAceite} contrato(s) aceito(s)`);

  if (!parts.length && (blockedBy.cobrancas ?? 0) > 0) {
    parts.push(`${blockedBy.cobrancas} cobrança(s)`);
  }

  const resumo = parts.length > 0 ? `Bloqueios encontrados: ${parts.join(', ')}.` : '';
  return `${resumo} Use cancelar matrícula para encerrar o vínculo e preservar histórico financeiro e contratual.`.trim();
}

function getApiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message;
  }

  if (typeof payload.error === 'object' && typeof payload.error.message === 'string' && payload.error.message.trim().length > 0) {
    return payload.error.message;
  }

  if (typeof payload.details?.providerMessage === 'string' && payload.details.providerMessage.trim().length > 0) {
    return payload.details.providerMessage;
  }

  if (typeof payload.error === 'object' && typeof payload.error.details?.providerMessage === 'string' && payload.error.details.providerMessage.trim().length > 0) {
    return payload.error.details.providerMessage;
  }

  return fallback;
}

export function AcoesMatricula({ matricula, onRefresh, onNavigateToList }: AcoesMatriculaProps) {
    const handleExcluir = useCallback(async (motivo: string) => {
      try {
        const res = await fetch(`/api/matriculas/${matricula.id}?hard=true`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo }),
        });

        if (!res.ok) {
          const errorData = (await res.json()) as ApiErrorPayload;
          if (getErrorCode(errorData) === 'MATRICULA_HARD_DELETE_BLOCKED') {
            const description = buildHardDeleteBlockedMessage(getBlockedByDetails(errorData));
            pushToast({
              title: 'Exclusão permanente indisponível',
              description,
              variant: 'warning',
            });
            return;
          }
          throw new Error(getApiErrorMessage(errorData, 'Não foi possível excluir a matrícula.'));
        }

        pushToast({
          title: 'Matrícula excluída com sucesso',
          description: 'A matrícula foi removida do sistema.',
          variant: 'success',
        });
        onNavigateToList();
      } catch (error) {
        pushToast({
          title: 'Erro ao excluir matrícula',
          description: (error as Error).message || 'Não foi possível excluir a matrícula.',
          variant: 'error',
        });
        throw error;
      }
    }, [matricula.id, onNavigateToList]);
  const [pausarDialogOpen, setPausarDialogOpen] = useState(false);
  const [retomarDialogOpen, setRetomarDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isAtiva = matricula.status === 'ATIVA';
  const isPausada = matricula.status === 'PAUSADA';
  const podeSerCancelada = isAtiva || isPausada;

  const handlePausar = useCallback(async (payload: PausarMatriculaPayload) => {
    try {
      const res = await fetch(`/api/matriculas/${matricula.id}/pausar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as ApiErrorPayload;
        throw new Error(getApiErrorMessage(errorData, 'Não foi possível pausar a matrícula.'));
      }

      const result = await res.json() as { warning?: string };

      if (result.warning) {
        pushToast({
          title: 'Matrícula pausada (apenas localmente)',
          description: result.warning,
          variant: 'warning',
        });
      } else {
        pushToast({
          title: 'Matrícula pausada com sucesso',
          description: payload.manterVaga
            ? 'Matrícula pausada com vaga reservada.'
            : 'Matrícula pausada e vaga liberada.',
          variant: 'success',
        });
      }

      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao pausar',
        description: (error as Error).message || 'Não foi possível pausar a matrícula.',
        variant: 'error',
      });
      throw error;
    }
  }, [matricula.id, onRefresh]);

  const handleRetomar = useCallback(async (payload: ReativarMatriculaPayload) => {
    try {
      const res = await fetch(`/api/matriculas/${matricula.id}/reativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as ApiErrorPayload;
        throw new Error(getApiErrorMessage(errorData, 'Não foi possível reativar a matrícula.'));
      }

      const result = await res.json() as { warning?: string };

      if (result.warning) {
        pushToast({
          title: 'Matrícula reativada (apenas localmente)',
          description: result.warning,
          variant: 'warning',
        });
      } else {
        pushToast({
          title: 'Matrícula reativada com sucesso',
          description: 'A matrícula foi reativada. Uma nova cobrança será gerada e o responsável será notificado.',
          variant: 'success',
        });
      }

      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao reativar',
        description: (error as Error).message || 'Não foi possível reativar a matrícula.',
        variant: 'error',
      });
      throw error;
    }
  }, [matricula.id, onRefresh]);

  const handleCancelar = useCallback(async (motivo: string) => {
    try {
      const res = await fetch(`/api/matriculas/${matricula.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'CANCELADA',
          motivo: motivo || undefined,
        }),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as ApiErrorPayload;
        throw new Error(getApiErrorMessage(errorData, 'Não foi possível cancelar a matrícula.'));
      }

      const result = await res.json();

      if (result.warning) {
        pushToast({
          title: 'Matrícula cancelada (apenas localmente)',
          description: 'A assinatura não foi encontrada no sistema financeiro. O status foi atualizado apenas no sistema local.',
          variant: 'warning',
        });
      } else {
        pushToast({
          title: 'Matrícula cancelada com sucesso',
          description: 'A matrícula foi cancelada. O responsável será notificado automaticamente.',
          variant: 'success',
        });
      }

      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao cancelar matrícula',
        description: (error as Error).message || 'Não foi possível cancelar a matrícula.',
        variant: 'error',
      });
      throw error;
    }
    }, [matricula.id, onRefresh]);

  return (
    <>
      <div className={sectionClass}>
        <span className="text-sm font-semibold text-slate-700">Ações da Matrícula</span>
        <p className="text-xs text-slate-600 mb-3">
          Gerencie o ciclo de vida da matrícula
        </p>

        {/* Ações - todos na mesma linha */}
        <div className="flex flex-wrap gap-2 mb-3">
          {isAtiva && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPausarDialogOpen(true)}
              className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 px-3 py-1.5"
            >
              <PauseIcon className="h-4 w-4 mr-1.5" />
              Pausar Temporariamente
            </Button>
          )}

          {isPausada && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetomarDialogOpen(true)}
              className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100 hover:border-green-400 px-3 py-1.5"
            >
              <PlayIcon className="h-4 w-4 mr-1.5" />
              Retomar Matrícula
            </Button>
          )}

          {podeSerCancelada && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelDialogOpen(true)}
              className="border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-400 px-3 py-1.5"
            >
              <XMarkIcon className="h-4 w-4 mr-1.5" />
              Cancelar Matrícula
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
            className="border-red-400 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-500 px-3 py-1.5"
          >
            <TrashIcon className="h-4 w-4 mr-1.5" />
            Excluir matrícula
          </Button>
        </div>

        <p className="text-xs text-amber-700 mb-3">
          Atenção: exclusão é permanente e só é permitida quando não existe histórico financeiro ou contratual relevante.
        </p>

        {/* Card informativo simplificado */}
        <InfoCallout title="Importante:" size="sm" showIcon={false}>
          <InfoCalloutItem label="Pausar" labelTone="warning">
            Suspende novas cobranças. Cobranças existentes permanecem ativas. Pode ser retomada.
          </InfoCalloutItem>
          <InfoCalloutItem label="Cancelar" labelTone="caution">
            Encerra a matrícula e cancela a cobrança recorrente. Mantém histórico. <strong>Irreversível.</strong>
          </InfoCalloutItem>
          <InfoCalloutItem label="Excluir" labelTone="danger">
            Remove completamente do sistema. Use apenas para erros ou duplicatas.{' '}
            <strong>Requer cobranças finalizadas.</strong>
          </InfoCalloutItem>
          <InfoCalloutItem label="Controle" labelTone="muted">
            Sempre informe o motivo ao cancelar para análises e melhorias.
          </InfoCalloutItem>
        </InfoCallout>
      </div>

      {/* Dialog de pausar */}
      <PausarMatriculaDialog
        open={pausarDialogOpen}
        onOpenChange={setPausarDialogOpen}
        alunoNome={matricula.aluno.nome}
        onConfirm={handlePausar}
      />

      {/* Dialog de retomar */}
      <ReativarMatriculaDialog
        open={retomarDialogOpen}
        onOpenChange={setRetomarDialogOpen}
        alunoNome={matricula.aluno.nome}
        vencimentoDia={matricula.vencimentoDia}
        onConfirm={handleRetomar}
      />

      {/* Dialog de cancelar */}
      <ActionDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancelar matrícula"
        description={`Deseja cancelar a matrícula de ${matricula.aluno.nome}? A cobrança recorrente será encerrada e as cobranças abertas vinculadas serão ajustadas automaticamente quando permitido. Esta ação não pode ser desfeita.`}
        confirmLabel="Cancelar matrícula"
        cancelLabel="Manter ativa"
        loadingLabel="Cancelando..."
        onConfirm={handleCancelar}
        motivoRequired={true}
        motivoLabel="Motivo do cancelamento"
        motivoPlaceholder="Ex: Mudança de cidade, não se adaptou, questões financeiras, troca de escola..."
        variant="warning"
      />

      {/* Dialog de excluir com confirmação dupla */}
      <DangerActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Excluir matrícula"
        description={`Você está prestes a solicitar a exclusão permanente da matrícula de ${matricula.aluno.nome}. A ação só será concluída se não existir histórico financeiro ou contratual relevante. Se houver bloqueios, mostraremos o motivo e orientaremos o cancelamento correto.`}
        confirmLabel="Confirmar exclusão"
        cancelLabel="Cancelar"
        loadingLabel="Excluindo..."
        onConfirm={handleExcluir}
        motivoRequired={true}
        motivoLabel="Motivo da exclusão"
        motivoPlaceholder="Ex: Cadastro duplicado, erro administrativo, matrícula de teste..."
        confirmationText="EXCLUIR"
        confirmationLabel="Digite EXCLUIR para confirmar"
      />
    </>
  );
}

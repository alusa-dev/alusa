'use client';

import * as React from 'react';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';

type DeletionBlockers = {
  activeMatriculas: number;
  activeSubscriptions: number;
  cobrancas?: {
    pending: number;
    processing: number;
    overdue: number;
    paid: number;
  };
};

type GatewaySyncError = {
  code: string;
  message: string;
  matriculaId?: string;
};

type DeletionResult = {
  aluno: { id: string; nome?: string };
  deletion: {
    outcome: 'ARCHIVED' | 'HARD_DELETED';
    blockers: DeletionBlockers;
    actionsTriggered?: string[];
    customerInactivation?: {
      action: 'INACTIVATED' | 'SKIPPED' | 'ERROR';
      reason?: string;
    };
    impact?: {
      matriculas?: { cancelled: number; errors: number };
      subscriptions?: { deleted: number; errors: number };
    };
    gatewaySync?: {
      ok: boolean;
      errors: GatewaySyncError[];
    };
  };
};

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  alunoId: string | null;
  alunoNome?: string;
  onDeleted?: () => void;
};

function buildBlockersSummary(blockers: DeletionBlockers): string {
  const parts: string[] = [];
  if (blockers.activeMatriculas > 0) {
    parts.push(`${blockers.activeMatriculas} matrícula(s)`);
  }
  if (blockers.activeSubscriptions > 0) {
    parts.push(`${blockers.activeSubscriptions} assinatura(s)`);
  }
  const pendingCharges = (blockers.cobrancas?.pending ?? 0) + (blockers.cobrancas?.processing ?? 0);
  if (pendingCharges > 0) {
    parts.push(`${pendingCharges} cobrança(s) pendente(s)`);
  }
  if (blockers.cobrancas?.overdue && blockers.cobrancas.overdue > 0) {
    parts.push(`${blockers.cobrancas.overdue} cobrança(s) atrasada(s)`);
  }
  return parts.join(', ');
}

export function AlunoDeleteDialog({ open, onOpenChange, alunoId, alunoNome, onDeleted }: Props) {
  const [motivo, setMotivo] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [conflictInfo, setConflictInfo] = React.useState<DeletionBlockers | null>(null);

  React.useEffect(() => {
    if (open) {
      setMotivo('');
      setConflictInfo(null);
    }
  }, [open]);

  async function handleConfirm() {
    if (!alunoId) return;
    
    const loadingToast = toast.message(
      conflictInfo 
        ? 'Arquivando aluno e cancelando vínculos...' 
        : 'Arquivando aluno e verificando vínculos...'
    );
    
    try {
      setSubmitting(true);
      const params = new URLSearchParams();
      if (motivo.trim()) params.set('motivo', motivo.trim());
      if (conflictInfo) params.set('forceDelete', 'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      
      const res = await fetch(`/api/alunos/${alunoId}${qs}`, { method: 'DELETE' });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao excluir' }));
        
        // 409 = conflito com matrículas/subscriptions ativas
        if (res.status === 409 && data.activeMatriculas !== undefined) {
          toast.dismiss(loadingToast);
          
          const blockers: DeletionBlockers = {
            activeMatriculas: data.activeMatriculas,
            activeSubscriptions: data.activeSubscriptions ?? 0,
            cobrancas: data.blockers?.cobrancas,
          };
          
          setConflictInfo(blockers);
          
          const summary = buildBlockersSummary(blockers);
          toast.warning(`Aluno possui vínculos ativos: ${summary}. Confirme para arquivar.`);
          return;
        }
        
        toast.dismiss(loadingToast);
        toast.error(data.error || 'Erro ao excluir');
        return;
      }
      
      toast.dismiss(loadingToast);
      
      // Parse resultado detalhado
      const result: DeletionResult = await res.json().catch(() => null);
      
      if (result?.deletion) {
        const { outcome, blockers, customerInactivation, impact, gatewaySync } = result.deletion;
        
        // Toast principal de sucesso
        if (outcome === 'ARCHIVED') {
          toast.success('Aluno arquivado. Mantivemos histórico financeiro e acadêmico.');
        } else {
          toast.success('Aluno excluído permanentemente.');
        }
        
        // Toast informativo sobre matrículas canceladas (baseado em impact)
        const cancelledMatriculas = impact?.matriculas?.cancelled ?? 0;
        if (cancelledMatriculas > 0) {
          toast.info(`${cancelledMatriculas} matrícula(s) foram canceladas automaticamente.`);
        }
        
        // Toast informativo sobre subscriptions deletadas no gateway
        const deletedSubscriptions = impact?.subscriptions?.deleted ?? 0;
        if (deletedSubscriptions > 0) {
          toast.info(`${deletedSubscriptions} assinatura(s) foram canceladas no processador.`);
        }
        
        // Toast informativo se havia blockers mas não foram cancelados
        const summary = buildBlockersSummary(blockers);
        if (summary && cancelledMatriculas === 0) {
          toast.info(`Vínculos encontrados: ${summary}`);
        }
        
        // Toast de erro parcial se houve erros ao cancelar matrículas
        const matriculaErrors = impact?.matriculas?.errors ?? 0;
        if (matriculaErrors > 0) {
          toast.warning(`${matriculaErrors} matrícula(s) não puderam ser canceladas. Verifique manualmente.`);
        }
        
        // Toast de warning se gateway sync falhou
        if (gatewaySync && !gatewaySync.ok) {
          toast.warning('Algumas cobranças podem não ter sido canceladas no processador. Verifique manualmente.');
        }
        
        // Toast sobre customer
        if (customerInactivation?.action === 'SKIPPED') {
          if (
            customerInactivation.reason === 'SHARED_WITH_ACTIVE_ALUNOS' ||
            customerInactivation.reason === 'SHARED_WITH_ACTIVE_MATRICULAS'
          ) {
            toast.warning('Pagador mantido pois possui outros vínculos ativos.');
          }
        } else if (customerInactivation?.action === 'ERROR') {
          toast.warning('Não foi possível inativar o cliente no processador de cobrança. Verifique manualmente.');
        }
      } else {
        toast.success('Aluno excluído');
      }
      
      try {
        window.dispatchEvent(new CustomEvent('alunos:changed'));
      } catch {
        /* noop */
      }
      onDeleted?.();
      onOpenChange(false);
    } catch {
      toast.dismiss(loadingToast);
      toast.error('Erro de comunicação. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  const baseDescription = alunoNome
    ? `Tem certeza que deseja arquivar ${alunoNome}? O histórico será mantido.`
    : 'Tem certeza que deseja arquivar este aluno? O histórico será mantido.';

  const conflictDescription = conflictInfo
    ? `⚠️ ${alunoNome ?? 'Este aluno'} possui ${buildBlockersSummary(conflictInfo)}. Ao confirmar, as matrículas serão inativadas e as cobranças pendentes serão canceladas.`
    : baseDescription;

  return (
    <ConfirmDeleteDialog
      open={open}
      title={conflictInfo ? 'Arquivar aluno com vínculos ativos' : 'Arquivar aluno'}
      description={conflictDescription}
      confirmLabel={submitting ? 'Arquivando...' : conflictInfo ? 'Confirmar arquivamento' : 'Arquivar'}
      cancelLabel="Cancelar"
      loadingLabel="Arquivando..."
      onOpenChange={onOpenChange}
      onConfirm={handleConfirm}
    >
      <div className="space-y-3 text-left">
        {conflictInfo && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">
              Esta ação irá:
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
              {conflictInfo.activeMatriculas > 0 && (
                <li>Inativar {conflictInfo.activeMatriculas} matrícula(s)</li>
              )}
              {conflictInfo.activeSubscriptions > 0 && (
                <li>Cancelar {conflictInfo.activeSubscriptions} assinatura(s) recorrente(s)</li>
              )}
              {(conflictInfo.cobrancas?.pending ?? 0) + (conflictInfo.cobrancas?.processing ?? 0) > 0 && (
                <li>Cancelar cobranças pendentes</li>
              )}
              <li>Arquivar o cadastro do aluno (histórico mantido)</li>
            </ul>
          </div>
        )}
        <label
          htmlFor="motivo-aluno"
          className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Motivo (opcional)
        </label>
        <textarea
          id="motivo-aluno"
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-[#7A1BFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/40"
          placeholder="Ex.: solicitação do responsável, mudança de cidade..."
        />
        <p className="text-xs leading-4 text-slate-500">
          Esse campo é opcional e fica registrado apenas para controle interno.
        </p>
      </div>
    </ConfirmDeleteDialog>
  );
}

export default AlunoDeleteDialog;

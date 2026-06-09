'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { pushToast } from '@/components/ui/toast';
import { Badge, type StatusType } from '@/components/ui/badge';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import { StatusMatricula } from '@prisma/client';
import { Help } from '@/components/icons/icons';

interface DadosMatriculaProps {
  matriculaId: string;
  matricula: {
    status: StatusMatricula;
    dataInicio: string;
    dataFim?: string | null;
    dataFimContrato?: string | null;
    vencimentoDia: number;
    asaasSubscriptionId?: string | null;
    assinaturaSnapshot?: {
      nextDueDate?: string | null;
    } | null;
    financialContext?: {
      mode: 'INDIVIDUAL' | 'FAMILY';
      responsavelFinanceiro: {
        id: string;
        nome: string;
        email?: string | null;
        telefone?: string | null;
      } | null;
      affectedMatriculaIds: string[];
      alunos: Array<{
        matriculaId: string;
        alunoId: string;
        nome: string;
      }>;
    } | null;
  };
  financialContext?: {
    mode: 'INDIVIDUAL' | 'FAMILY';
    responsavelFinanceiro: {
      id: string;
      nome: string;
      email?: string | null;
      telefone?: string | null;
    } | null;
    affectedMatriculaIds: string[];
    alunos: Array<{
      matriculaId: string;
      alunoId: string;
      nome: string;
    }>;
  } | null;
  assinaturaSnapshot?: {
    nextDueDate?: string | null;
  } | null;
  pausaResumo?: unknown;
  cobrancas?: unknown[];
  onRefresh: () => void;
}

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const editButtonClass = 'h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed';
const labelRowClass = 'flex h-5 items-center gap-1.5';
const billingDayTooltip =
  'Este campo conversa com a régua financeira da Alusa. A alteração vale para os próximos ciclos e pode ajustar cobranças ainda editáveis.';
const familyBillingDayTooltip =
  'Este campo conversa com a assinatura familiar do responsável financeiro. A alteração vale para todo o grupo familiar e pode ajustar cobranças ainda editáveis.';
const localBillingDayTooltip =
  'Sem vínculo financeiro ativo, este campo permanece apenas no cadastro local da matrícula.';

function toDateInputValue(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

function parseDateInput(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeBillingDay(day: number) {
  return Math.min(28, Math.max(1, day));
}

function computeNextDueDate(currentNextDueDate: string, billingDay: number) {
  const base = parseDateInput(toDateInputValue(currentNextDueDate));
  if (!base) return null;

  const candidate = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), normalizeBillingDay(billingDay), 12),
  );

  if (candidate < base) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }

  return candidate;
}

function maxDateInput(...values: Array<string | null | undefined>) {
  const dates = values
    .map((value) => parseDateInput(value))
    .filter((value): value is Date => Boolean(value));
  if (dates.length === 0) return undefined;
  return formatDateInput(new Date(Math.max(...dates.map((date) => date.getTime()))));
}

export function DadosMatricula({
  matriculaId,
  matricula,
  financialContext,
  assinaturaSnapshot,
  onRefresh,
}: DadosMatriculaProps) {
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const resolvedFinancialContext = financialContext ?? matricula.financialContext ?? null;
  const isFamilyBilling = resolvedFinancialContext?.mode === 'FAMILY';
  const familyStudentNames =
    resolvedFinancialContext?.alunos.map((aluno) => aluno.nome).filter(Boolean) ?? [];
  const familyStudentSummary =
    familyStudentNames.length > 0
      ? familyStudentNames.slice(0, 3).join(', ') +
        (familyStudentNames.length > 3 ? ` e mais ${familyStudentNames.length - 3}` : '')
      : `${resolvedFinancialContext?.affectedMatriculaIds.length ?? 0} matrículas`;
  const billingTooltip = isFamilyBilling
    ? familyBillingDayTooltip
    : matricula.asaasSubscriptionId
      ? billingDayTooltip
      : localBillingDayTooltip;
  const resolvedAssinaturaSnapshot = assinaturaSnapshot ?? matricula.assinaturaSnapshot ?? null;
  const currentNextDueDate = resolvedAssinaturaSnapshot?.nextDueDate
    ? toDateInputValue(resolvedAssinaturaSnapshot.nextDueDate)
    : null;

  const [dataInicio, setDataInicio] = useState(
    toDateInputValue(matricula.dataInicio)
  );
  const [dataFimContrato, setDataFimContrato] = useState(
    toDateInputValue(matricula.dataFimContrato ?? matricula.dataFim)
  );
  const [vencimentoDia, setVencimentoDia] = useState(matricula.vencimentoDia.toString());

  const handleCancelar = useCallback(() => {
    setDataInicio(toDateInputValue(matricula.dataInicio));
    setDataFimContrato(toDateInputValue(matricula.dataFimContrato ?? matricula.dataFim));
    setVencimentoDia(matricula.vencimentoDia.toString());
    setEditando(false);
  }, [matricula]);

  const handleSalvar = useCallback(async () => {
    try {
      setSalvando(true);

      const payload: Record<string, unknown> = {};

      if (dataFimContrato !== toDateInputValue(matricula.dataFimContrato ?? matricula.dataFim)) {
        payload.dataFimContrato = new Date(dataFimContrato).toISOString();
      }

      const newVencDia = parseInt(vencimentoDia, 10);
      if (newVencDia !== matricula.vencimentoDia) {
        payload.vencimentoDia = newVencDia;
      }

      if (Object.keys(payload).length === 0) {
        pushToast({
          title: 'Sem alterações',
          description: 'Nenhum dado foi modificado.',
          variant: 'info',
        });
        setEditando(false);
        return;
      }

      const res = await fetch(`/api/matriculas/${matriculaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errorData = data;
        throw new Error(errorData.error?.message || 'Erro ao atualizar matrícula');
      }

      pushToast({
        title: 'Matrícula atualizada',
        description:
          (data as { asyncSync?: { message?: string } } | null)?.asyncSync?.message ||
          'Os dados da matrícula foram atualizados com sucesso.',
        variant: 'success',
      });

      setEditando(false);
      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao atualizar',
        description: (error as Error).message || 'Não foi possível atualizar os dados.',
        variant: 'error',
      });
    } finally {
      setSalvando(false);
    }
  }, [matriculaId, matricula, dataFimContrato, vencimentoDia, onRefresh]);

  const selectedBillingDay = Number.parseInt(vencimentoDia, 10);
  const selectedNextDueDate = currentNextDueDate
    ? computeNextDueDate(currentNextDueDate, selectedBillingDay)
    : null;
  const selectedEndDate = parseDateInput(dataFimContrato);
  const dataFimMin = maxDateInput(
    toDateInputValue(matricula.dataInicio),
    selectedNextDueDate ? formatDateInput(selectedNextDueDate) : null,
  );
  const invalidAsaasPeriod =
    Boolean(selectedNextDueDate && selectedEndDate && selectedNextDueDate > selectedEndDate);
  const periodValidationMessage =
    invalidAsaasPeriod && selectedNextDueDate && selectedEndDate
      ? `A data de fim precisa ser em ${selectedNextDueDate.toLocaleDateString('pt-BR')} ou depois para usar o Dia ${selectedBillingDay}.`
      : null;
  const saveDisabled = salvando || invalidAsaasPeriod;

  const billingDays = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => {
      const day = i + 1;
      const nextDueDate = currentNextDueDate ? computeNextDueDate(currentNextDueDate, day) : null;
      const disabled = Boolean(nextDueDate && selectedEndDate && nextDueDate > selectedEndDate);
      return {
        day,
        disabled,
        nextDueDate,
      };
    });
  }, [currentNextDueDate, selectedEndDate]);

  return (
    <div className={sectionClass}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex min-h-10 items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">
            {isFamilyBilling ? 'Informações da Matrícula Familiar' : 'Informações da Matrícula'}
          </span>
          <Badge status={matricula.status as StatusType} />
        </div>
        {!editando ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditando(true)}
            className={editButtonClass}
          >
            Editar
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelar}
              disabled={salvando}
              className="border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSalvar}
              disabled={saveDisabled}
              className="bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90"
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        )}
      </div>

      {isFamilyBilling ? (
        <InfoCallout size="sm">
          <InfoCalloutItem label="Cobrança familiar" labelTone="default">
            {`Data de fim e dia de vencimento pertencem à assinatura do responsável ${resolvedFinancialContext?.responsavelFinanceiro?.nome ?? 'financeiro'}. Alterações nesses campos afetam ${familyStudentSummary}.`}
          </InfoCalloutItem>
        </InfoCallout>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <div className={labelRowClass}>
            <label className={labelClass}>Data de Início</label>
          </div>
          <Input
            type="date"
            value={dataInicio}
            disabled
            className={controlClass}
          />
        </div>

        <div className="space-y-1">
          <div className={labelRowClass}>
            <label className={labelClass}>Data de Fim</label>
            {isFamilyBilling ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Sobre a data de fim familiar"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/40"
                    >
                      <Help className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-left leading-relaxed">
                    A data de fim atualiza o encerramento da assinatura familiar do responsável e é replicada para as matrículas vinculadas.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
          <Input
            type="date"
            value={dataFimContrato}
            onChange={(e) => setDataFimContrato(e.target.value)}
            disabled={!editando}
            min={dataFimMin}
            className={controlClass}
          />
          {editando && periodValidationMessage ? (
            <p className="text-xs text-red-600">{periodValidationMessage}</p>
          ) : null}
        </div>

        <div className="space-y-1">
          <div className={labelRowClass}>
            <label className={labelClass}>Dia de Vencimento</label>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Sobre o dia de vencimento"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/40"
                  >
                    <Help className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px] text-left leading-relaxed">
                  {billingTooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Select
            value={vencimentoDia}
            onValueChange={setVencimentoDia}
            disabled={!editando}
          >
            <SelectTrigger className="h-10 w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-900 shadow-sm focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed">
              <SelectValue placeholder="Selecione o dia" />
            </SelectTrigger>
            <SelectContent>
              {billingDays.map(({ day, disabled, nextDueDate }) => (
                <SelectItem key={day} value={day.toString()} disabled={disabled}>
                  {nextDueDate && disabled
                    ? `Dia ${day} - após a data fim`
                    : `Dia ${day}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {editando && periodValidationMessage ? (
        <InfoCallout variant="warning" size="sm">
          <InfoCalloutItem label="Período da assinatura" labelTone="warning">
            {periodValidationMessage}
          </InfoCalloutItem>
        </InfoCallout>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import type { WizardContextValue } from '../types';
import {
  previewInitialEnrollmentBillingRequest,
  type InitialEnrollmentBillingPreviewResult,
} from '@/features/cadastro/matriculas/services/matriculas-service';
import {
  calcularValorDescontoBeneficio,
  calcularValorLiquidoComBeneficio,
  descreverBeneficioSelecionado,
} from '../beneficios';
import {
  calculateFamilyBenefitTotal,
  calculateFamilyMonthlyTotal,
} from '../family-pricing';

interface StepResumoProps {
  ctx: WizardContextValue;
}

function BillingOperationalSummary({
  preview,
}: {
  preview: InitialEnrollmentBillingPreviewResult;
}) {
  const blocked = !preview.compatibility.compatible;
  const requiresAttention =
    blocked ||
    preview.billingImpact.currentCycleAction === 'CREATE_COMPLEMENT' ||
    preview.billingImpact.currentCycleAction === 'CREATE_ONE_TIME_CHARGE';
  const nextCycleDate = preview.billingImpact.nextCycleDate
    ? new Date(preview.billingImpact.nextCycleDate).toLocaleDateString('pt-BR')
    : null;
  const friendlyMessage =
    preview.billingImpact.currentCycleAction === 'UPDATE_PENDING'
      ? 'A cobrança atual está pendente e será atualizada com o novo valor após a confirmação dos dados.'
      : preview.billingImpact.currentCycleAction === 'SCHEDULE_NEXT_CYCLE'
        ? 'A cobrança atual será mantida. A mudança será aplicada a partir do próximo ciclo.'
        : preview.billingImpact.currentCycleAction === 'CREATE_COMPLEMENT'
          ? 'A cobrança atual já foi paga. O valor deste aluno será gerado em uma cobrança complementar.'
          : preview.billingImpact.currentCycleAction === 'MANUAL_REVIEW'
            ? 'A cobrança atual precisa ser revisada antes de incluir este aluno no agrupamento.'
            : preview.billingImpact.operationalMessage;

  return (
    <InfoCallout
      variant={blocked || requiresAttention ? 'warning' : 'info'}
      size="md"
      className={
        blocked || requiresAttention
          ? "relative border-0 !pl-8 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-1 before:rounded-full before:bg-amber-500 before:content-['']"
          : "relative border-0 !pl-8 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-1 before:rounded-full before:bg-[#1f6b75] before:content-['']"
      }
      role={blocked ? 'alert' : 'status'}
      title={blocked ? 'Revise antes de continuar' : 'Como ficará a cobrança?'}
    >
      <InfoCalloutItem label="Próximo passo">{friendlyMessage}</InfoCalloutItem>
      {preview.billingImpact.currentChargeDueDate && (
        <InfoCalloutItem label="Cobrança atual">
          {preview.billingImpact.currentChargeState === 'PAID'
            ? 'Paga'
            : preview.billingImpact.currentChargeState === 'OVERDUE'
              ? 'Vencida'
              : preview.billingImpact.currentChargeState === 'PENDING'
                ? 'Pendente'
                : preview.billingImpact.currentChargeState.toLowerCase()}{' '}
          — vencimento em{' '}
          {new Date(preview.billingImpact.currentChargeDueDate).toLocaleDateString('pt-BR')}.
        </InfoCalloutItem>
      )}
      {preview.billingImpact.application === 'NEXT_CYCLE' && nextCycleDate && (
        <InfoCalloutItem label="Quando será aplicado">A partir de {nextCycleDate}.</InfoCalloutItem>
      )}
      {preview.validityImpact && (
        <div>
          <InfoCalloutItem label="Fim da nova matrícula">
            {new Date(preview.validityImpact.addedEndDate).toLocaleDateString('pt-BR')}
          </InfoCalloutItem>
          {preview.validityImpact.existingEndDate && (
            <InfoCalloutItem label="Fim da cobrança compartilhada">
              {new Date(preview.validityImpact.resultingEndDate).toLocaleDateString('pt-BR')}
            </InfoCalloutItem>
          )}
        </div>
      )}
      {preview.compatibility.blockers.length > 0 && (
        <div>
          {preview.compatibility.blockers.map((blocker) => (
            <InfoCalloutItem key={`${blocker.code}:${blocker.itemId ?? ''}`} label="Atenção">
              {blocker.message}
            </InfoCalloutItem>
          ))}
        </div>
      )}
      {preview.compatibility.warnings.length > 0 && (
        <div>
          {preview.compatibility.warnings.map((warning) => (
            <InfoCalloutItem key={warning} label="Importante">
              {warning}
            </InfoCalloutItem>
          ))}
        </div>
      )}
    </InfoCallout>
  );
}

export function StepResumo({ ctx }: StepResumoProps) {
  const { state } = ctx;

  // Familiar mode
  if (state.modoMatricula === 'FAMILIAR') {
    return <StepResumoFamiliar ctx={ctx} />;
  }

  // Individual mode (original)
  return <StepResumoIndividual ctx={ctx} />;
}

function StepResumoFamiliar({ ctx }: StepResumoProps) {
  const { state, update } = ctx;
  const [billingPreview, setBillingPreview] =
    useState<InitialEnrollmentBillingPreviewResult | null>(null);
  const [billingPreviewLoading, setBillingPreviewLoading] = useState(true);
  const [billingPreviewError, setBillingPreviewError] = useState<string | null>(null);

  const formatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    [],
  );

  const calcularLiquido = (valorBase: number) =>
    calcularValorLiquidoComBeneficio(valorBase, state.beneficioSelecionado);
  const valorBeneficio = calculateFamilyBenefitTotal(state);
  const totalMensalidades = calculateFamilyMonthlyTotal(state);
  const beneficioDescricao = descreverBeneficioSelecionado(state.beneficioSelecionado);

  const totalTaxas = state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0);

  useEffect(() => {
    if (
      !state.responsavelFamiliar?.id ||
      !state.dataInicio ||
      !state.dataFimContrato ||
      !state.formaPagamento ||
      !state.vencimentoDia ||
      state.alunosFamiliares.length < 1
    ) {
      setBillingPreview(null);
      setBillingPreviewLoading(false);
      setBillingPreviewError('Volte e complete os dados familiares para gerar o preview.');
      update({ confirmacaoRevisao: false });
      return;
    }
    let active = true;
    const billingStrategy = state.billingStrategy ?? { kind: 'SEPARATE' as const };
    const paymentMethod =
      state.formaPagamento === 'PIX' ||
      state.formaPagamento === 'BOLETO' ||
      state.formaPagamento === 'CARTAO_CREDITO'
        ? state.formaPagamento
        : 'BOLETO';
    setBillingPreviewLoading(true);
    setBillingPreviewError(null);
    previewInitialEnrollmentBillingRequest({
      contaId: state.contaId || undefined,
      enrollmentMode: 'FAMILY',
      familyPricingMode:
        state.modoTurmas === 'TURMAS' ? 'AGGREGATE_PLAN' : 'ITEMIZED_COMBOS',
      aggregateMonthlyAmount: totalMensalidades,
      aggregateEnrollmentFeeAmount: totalTaxas,
      billingStrategy,
      strategy:
        billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
          ? 'INCLUDE_EXISTING'
          : billingStrategy.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
            ? 'UNIFY_NEXT_CYCLE'
            : 'CREATE_SEPARATE',
      existingFamilyGroupId:
        billingStrategy.kind === 'SEPARATE' ? null : billingStrategy.financialGroupId,
      responsavelFinanceiroId: state.responsavelFamiliar.id,
      dataInicio: state.dataInicio,
      dataFimContrato: state.dataFimContrato,
      formaPagamento: paymentMethod,
      vencimentoDia: state.vencimentoDia,
      descontoIds: state.beneficioSelecionado?.id ? [state.beneficioSelecionado.id] : [],
      items: state.alunosFamiliares.map((aluno) => ({
        alunoId: aluno.id,
        turmaId: state.modoTurmas === 'TURMAS' ? aluno.turmaId ?? null : null,
        comboId: state.modoTurmas === 'COMBO' ? aluno.comboId ?? null : null,
        planoId: state.modoTurmas === 'TURMAS' ? state.planoId ?? null : null,
        taxaMatricula: totalTaxas,
      })),
    })
      .then((preview) => {
        if (!active) return;
        setBillingPreview(preview);
        if (!preview.compatibility.compatible) {
          update({ confirmacaoRevisao: false });
        }
      })
      .catch((error) => {
        if (!active) return;
        setBillingPreview(null);
        setBillingPreviewError(
          error instanceof Error ? error.message : 'Não foi possível gerar o preview financeiro.',
        );
        update({ confirmacaoRevisao: false });
      })
      .finally(() => {
        if (active) setBillingPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    state.alunosFamiliares,
    state.beneficioSelecionado?.id,
    state.billingStrategy,
    state.contaId,
    state.dataFimContrato,
    state.dataInicio,
    state.formaPagamento,
    state.modoTurmas,
    state.planoId,
    state.responsavelFamiliar?.id,
    state.taxaMatricula,
    state.taxaIsenta,
    state.vencimentoDia,
    totalMensalidades,
    totalTaxas,
    update,
  ]);

  const formaPagamentoLabel = (forma: string | undefined) => {
    if (!forma) return '—';
    const labels: Record<string, string> = {
      PIX: 'PIX',
      CARTAO: 'Cartão',
      CARTAO_CREDITO: 'Cartão de crédito',
      BOLETO: 'Boleto',
      DINHEIRO: 'Dinheiro',
    };
    return labels[forma] ?? forma;
  };

  const handleConfirmacaoChange = (checked: boolean | 'indeterminate') => {
    update({ confirmacaoRevisao: checked === true });
  };

  return (
    <SectionCard>
      <StepHeader title="Resumo" hint="Confirme os dados antes de finalizar as matrículas." />

      <div className="space-y-4">
        {/* Responsável */}
        {state.responsavelFamiliar && (
          <div className="rounded-xl bg-slate-50/70 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Responsável financeiro</h3>
            <div className="mt-3 flex justify-between gap-4 text-sm">
              <span className="text-gray-600">Nome</span>
              <span className="text-right font-medium text-gray-900">
                {state.responsavelFamiliar.nome}
              </span>
            </div>
          </div>
        )}

        {/* Alunos */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">
            Alunos ({state.alunosFamiliares.length})
          </p>
          {state.alunosFamiliares.map((aluno) => {
            const iniciais = aluno.nome
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase())
              .join('');

            const turmaOuCombo =
              state.modoTurmas === 'COMBO' ? (aluno.comboLabel ?? '—') : (aluno.turmaLabel ?? '—');

            return (
              <div
                key={aluno.itemId ?? aluno.id}
                className="flex items-center gap-3 rounded-xl bg-slate-50/70 p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                  {iniciais}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{aluno.nome}</p>
                  <p className="text-xs text-slate-500">
                    {state.modoTurmas === 'COMBO' ? 'Combo: ' : 'Turma: '}
                    {turmaOuCombo}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">
                    {state.modoTurmas === 'COMBO' ? 'Combo' : 'Plano familiar'}
                  </p>
                  <p className="text-sm font-semibold text-slate-800">
                    {state.modoTurmas === 'COMBO'
                      ? formatter.format(calcularLiquido(aluno.comboValor ?? 0))
                      : 'Incluído'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl bg-slate-50/70 p-4 text-sm">
          <h3 className="font-semibold text-slate-900">O que será cobrado</h3>

          <div className="mt-3 space-y-2">
            <div className="flex justify-between gap-4">
              <span className="text-slate-600">
                {state.modoTurmas === 'COMBO' ? 'Total das mensalidades' : 'Plano familiar'}
              </span>
              <span className="font-semibold text-slate-900">{formatter.format(totalMensalidades)}</span>
            </div>
            {beneficioDescricao && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">Benefício</span>
                <span className="text-right font-medium text-slate-900">
                  {beneficioDescricao} (-{formatter.format(valorBeneficio)})
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-slate-600">Pagamento mensal</span>
              <span className="font-medium text-slate-900">{formaPagamentoLabel(state.formaPagamento)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-600">Taxa de matrícula</span>
              <span className="font-semibold text-slate-900">
                {state.taxaIsenta ? 'Isenta' : formatter.format(totalTaxas)}
              </span>
            </div>
            {!state.taxaIsenta && state.formaPagamentoTaxa && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">Pagamento da taxa</span>
                <span className="font-medium text-slate-900">
                  {formaPagamentoLabel(state.formaPagamentoTaxa)}
                </span>
              </div>
            )}
            {state.criarCobranca && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-slate-600">Cobranças recorrentes</span>
                <span className="font-medium text-slate-900">1 cobrança consolidada</span>
              </div>
            )}
          </div>

          {billingPreviewLoading ? (
            <p className="mt-2 text-slate-600">Validando agrupamento e valores...</p>
          ) : billingPreviewError ? (
            <p className="mt-2 text-red-700" role="alert">{billingPreviewError}</p>
          ) : billingPreview ? (
            <div className="mt-2 space-y-3">
              {billingPreview.billingImpact.application !== 'SEPARATE' && (
                <div className="grid gap-1 text-slate-600 sm:grid-cols-2">
                  <span>Valor atual: {formatter.format(billingPreview.billingImpact.currentMonthlyAmount)}</span>
                  <strong className="text-slate-900">
                    Novo total mensal: {formatter.format(billingPreview.billingImpact.resultingMonthlyAmount)}
                  </strong>
                </div>
              )}
              <BillingOperationalSummary preview={billingPreview} />
            </div>
          ) : null}
        </div>

        {/* Confirmação */}
        <div className="rounded-xl bg-slate-50/70 p-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="confirmacao-revisao-familiar"
              checked={state.confirmacaoRevisao}
              onCheckedChange={handleConfirmacaoChange}
              disabled={billingPreviewLoading || Boolean(billingPreviewError) || !billingPreview?.compatibility.compatible}
              className="mt-0.5"
            />
            <Label
              htmlFor="confirmacao-revisao-familiar"
              className="text-sm text-slate-700 cursor-pointer"
            >
              Confirmo que revisei todas as informações das matrículas.
            </Label>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function StepResumoIndividual({ ctx }: StepResumoProps) {
  const { state, update } = ctx;
  const [billingPreview, setBillingPreview] =
    useState<InitialEnrollmentBillingPreviewResult | null>(null);
  const [billingPreviewLoading, setBillingPreviewLoading] = useState(true);
  const [billingPreviewError, setBillingPreviewError] = useState<string | null>(null);
  const turmaId = state.turmaIds[0];
  const initials = useMemo(() => {
    if (!state.aluno?.nome) return '';
    return state.aluno.nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('');
  }, [state.aluno?.nome]);

  const formatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    [],
  );

  const valorMensalidade =
    state.modoTurmas === 'COMBO' ? (state.comboValor ?? 0) : (state.planoValor ?? 0);
  const valorBeneficio = calcularValorDescontoBeneficio(
    valorMensalidade,
    state.beneficioSelecionado,
  );
  const valorMensalidadeLiquido = calcularValorLiquidoComBeneficio(
    valorMensalidade,
    state.beneficioSelecionado,
  );
  const beneficioDescricao = descreverBeneficioSelecionado(state.beneficioSelecionado);

  useEffect(() => {
    const alunoId = state.aluno?.id;
    if (!alunoId || !state.dataInicio || !state.dataFimContrato || !state.formaPagamento || !state.vencimentoDia) {
      setBillingPreview(null);
      setBillingPreviewLoading(false);
      setBillingPreviewError('Volte e complete os dados financeiros para gerar o preview.');
      update({ confirmacaoRevisao: false });
      return;
    }

    let active = true;
    setBillingPreviewLoading(true);
    setBillingPreviewError(null);
    const billingStrategy = state.billingStrategy ?? { kind: 'SEPARATE' as const };
    const formaPagamento = state.formaPagamento === 'CARTAO'
      ? 'CARTAO_CREDITO'
      : state.formaPagamento;

    previewInitialEnrollmentBillingRequest({
      contaId: state.contaId || undefined,
      billingStrategy,
      strategy:
        billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
          ? 'INCLUDE_EXISTING'
          : billingStrategy.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
            ? 'UNIFY_NEXT_CYCLE'
            : 'CREATE_SEPARATE',
      existingFamilyGroupId:
        billingStrategy.kind === 'SEPARATE' ? null : billingStrategy.financialGroupId,
      responsavelFinanceiroId: state.aluno?.responsavel?.id ?? null,
      dataInicio: state.dataInicio,
      dataFimContrato: state.dataFimContrato,
      formaPagamento:
        formaPagamento === 'PIX' || formaPagamento === 'BOLETO' || formaPagamento === 'CARTAO_CREDITO'
          ? formaPagamento
          : 'BOLETO',
      vencimentoDia: state.vencimentoDia,
      descontoIds: state.beneficioSelecionado?.id ? [state.beneficioSelecionado.id] : [],
      items: [
        {
          alunoId,
          turmaId: state.turmaIds[0] ?? null,
          comboId: state.modoTurmas === 'COMBO' ? state.comboId ?? null : null,
          planoId: state.modoTurmas === 'COMBO' ? null : state.planoId ?? null,
          taxaMatricula: state.taxaIsenta ? 0 : state.taxaMatricula ?? 0,
        },
      ],
    })
      .then((preview) => {
        if (!active) return;
        setBillingPreview(preview);
        if (!preview.compatibility.compatible) {
          update({ confirmacaoRevisao: false });
        }
      })
      .catch((error) => {
        if (!active) return;
        setBillingPreview(null);
        setBillingPreviewError(error instanceof Error ? error.message : 'Não foi possível gerar o preview financeiro.');
        update({ confirmacaoRevisao: false });
      })
      .finally(() => {
        if (active) setBillingPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    state.aluno?.id,
    state.aluno?.responsavel?.id,
    state.beneficioSelecionado?.id,
    state.billingStrategy,
    state.comboId,
    state.contaId,
    state.dataFimContrato,
    state.dataInicio,
    state.formaPagamento,
    state.modoTurmas,
    state.planoId,
    state.taxaIsenta,
    state.taxaMatricula,
    state.turmaIds,
    state.vencimentoDia,
    update,
  ]);

  const temMulta = Boolean(state.multaPercentual && state.multaPercentual > 0);
  const temJuros = Boolean(state.jurosMensal && state.jurosMensal > 0);
  const temDesconto = Boolean(state.descontoAntecipado && state.descontoAntecipado > 0);

  const handleConfirmacaoChange = (checked: boolean | 'indeterminate') => {
    update({ confirmacaoRevisao: checked === true });
  };

  const formaPagamentoLabel = (forma: string | undefined) => {
    if (!forma) return '—';
    const labels: Record<string, string> = {
      PIX: 'PIX',
      CARTAO: 'Cartão',
      CARTAO_CREDITO: 'Cartão de crédito',
      BOLETO: 'Boleto',
      DINHEIRO: 'Dinheiro',
    };
    return labels[forma] ?? forma;
  };

  const notificationLabel = (channel: string) => {
    const labels: Record<string, string> = {
      WHATSAPP: 'WhatsApp',
      EMAIL: 'E-mail',
      SMS: 'SMS',
    };
    return labels[channel] ?? channel;
  };

  return (
    <SectionCard>
      <StepHeader title="Resumo" hint="Confirme os dados antes de finalizar a matrícula." />

      <div className="space-y-4">
        {/* Aluno + detalhes (sem segundo card de plano/combo) */}
        <div className="rounded-xl bg-slate-50/70 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
              {initials || 'A'}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {state.aluno?.nome ?? 'Aluno não selecionado'}
              </p>
              <div className="space-y-0.5 text-xs text-gray-500">
                {state.aluno?.dataNasc && (
                  <p>Nascimento: {new Date(state.aluno.dataNasc).toLocaleDateString('pt-BR')}</p>
                )}
                {state.aluno?.email && <p>E-mail: {state.aluno.email}</p>}
                {state.aluno?.telefone && <p>Telefone: {state.aluno.telefone}</p>}
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-1 pt-4 text-sm text-gray-600">
            {state.modeloId && (
              <p>
                Modelo:{' '}
                <span className="font-medium text-gray-900">
                  {state.modeloNome || 'Selecionado'}
                </span>
              </p>
            )}
            <p>
              Pagamento:{' '}
              <span className="font-medium text-gray-900">
                {formaPagamentoLabel(state.formaPagamento)}
              </span>
            </p>
            {turmaId && (
              <p>
                Turma:{' '}
                <span className="font-medium text-gray-900">{state.turmaLabel || turmaId}</span>
              </p>
            )}
            <p>
              Início:{' '}
              <span className="font-medium text-gray-900">
                {state.dataInicio
                  ? new Date(state.dataInicio).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })
                  : '—'}
              </span>
            </p>
            {state.dataFimContrato && (
              <p>
                Fim:{' '}
                <span className="font-medium text-gray-900">
                  {new Date(state.dataFimContrato).toLocaleDateString('pt-BR')}
                </span>
              </p>
            )}
          </div>
        </div>

        {state.aluno?.responsavel && (
          <div className="rounded-xl bg-slate-50/70 p-4">
            <h3 className="text-sm font-semibold text-gray-900">Responsável financeiro</h3>
            <div className="mt-3 flex justify-between gap-4 text-sm">
              <span className="text-gray-600">Nome</span>
              <span className="text-right font-medium text-gray-900">
                {state.aluno.responsavel.nome}
              </span>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-slate-50/70 p-4">
          <h3 className="text-sm font-semibold text-gray-900">O que será cobrado</h3>

          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-600">Mensalidade</span>
              <span className="font-semibold text-gray-900">{formatter.format(valorMensalidadeLiquido)}</span>
            </div>
            {beneficioDescricao && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Benefício</span>
                <span className="text-right font-medium text-gray-900">
                  {beneficioDescricao} (-{formatter.format(valorBeneficio)})
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-gray-600">Pagamento mensal</span>
              <span className="font-medium text-gray-900">{formaPagamentoLabel(state.formaPagamento)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-600">Taxa de matrícula</span>
              <span className="font-semibold text-gray-900">
                {state.taxaIsenta ? 'Isenta' : formatter.format(state.taxaMatricula ?? 0)}
              </span>
            </div>
            {!state.taxaIsenta && state.formaPagamentoTaxa && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Pagamento da taxa</span>
                <span className="font-medium text-gray-900">
                  {formaPagamentoLabel(state.formaPagamentoTaxa)}
                </span>
              </div>
            )}
            {state.taxaIsenta && state.taxaJustificativa && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Motivo da isenção</span>
                <span className="text-right font-medium text-gray-900">{state.taxaJustificativa}</span>
              </div>
            )}
          </div>

          {billingPreviewLoading ? (
            <p className="mt-2 text-sm text-gray-600">Calculando valores atuais e resultantes...</p>
          ) : billingPreviewError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">{billingPreviewError}</p>
          ) : billingPreview ? (
            <div className="mt-3 space-y-2 text-sm">
              {billingPreview.billingImpact.targetLabel && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Cobrança de destino</span>
                  <span className="text-right font-medium text-gray-900">{billingPreview.billingImpact.targetLabel}</span>
                </div>
              )}
              {billingPreview.billingImpact.application !== 'SEPARATE' && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Valor mensal atual</span>
                  <span className="font-medium">{formatter.format(billingPreview.billingImpact.currentMonthlyAmount)}</span>
                </div>
              )}
              {billingPreview.billingImpact.application !== 'SEPARATE' && (
                <div className="flex justify-between pt-2 text-base">
                  <span className="font-semibold text-gray-900">Novo total mensal</span>
                  <span className="font-semibold text-violet-800">
                    {formatter.format(billingPreview.billingImpact.resultingMonthlyAmount)}
                  </span>
                </div>
              )}
              {billingPreview.billingImpact.updatesPendingPayments && (
                <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                  Aplicação no ciclo atual: cobranças pendentes já emitidas poderão ter o valor atualizado.
                </p>
              )}
              {billingPreview.billingImpact.application === 'NEXT_CYCLE' && (
                <p className="text-sm text-gray-600">O valor será unificado somente no próximo ciclo.</p>
              )}
              <BillingOperationalSummary preview={billingPreview} />
            </div>
          ) : null}
        </div>

        {/* Box Configurações de Cobrança - só se houver */}
        {(temMulta || temJuros || temDesconto) && (
          <div className="rounded-xl bg-slate-50/70 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Configurações de cobrança</h3>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              {temMulta && (
                <p className="text-gray-600">
                  Multa: <span className="font-medium text-gray-900">{state.multaPercentual}%</span>
                </p>
              )}
              {temJuros && (
                <p className="text-gray-600">
                  Juros:{' '}
                  <span className="font-medium text-gray-900">{state.jurosMensal}% a.m.</span>
                </p>
              )}
              {temDesconto && (
                <p className="text-gray-600">
                  Desconto:{' '}
                  <span className="font-medium text-gray-900">
                    {state.descontoTipo === 'PERCENTAGE'
                      ? `${state.descontoAntecipado}%`
                      : formatter.format(state.descontoAntecipado ?? 0)}
                    {state.prazoDesconto ? ` (${state.prazoDesconto}d)` : ''}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}

        {(state.notificationChannelsTouched || state.notificationChannels.length > 0) && (
          <div className="rounded-xl bg-slate-50/70 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Notificações</h3>
            <p className="text-sm text-gray-600">
              Canais:{' '}
              <span className="font-medium text-gray-900">
                {state.notificationChannels.length > 0
                  ? state.notificationChannels.map(notificationLabel).join(', ')
                  : 'Nenhuma'}
              </span>
            </p>
          </div>
        )}

        {/* Checkbox de confirmação */}
        <div className="rounded-xl bg-slate-50/70 p-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="confirmacao-revisao"
              checked={state.confirmacaoRevisao}
              disabled={billingPreviewLoading || Boolean(billingPreviewError) || !billingPreview?.compatibility.compatible}
              onCheckedChange={handleConfirmacaoChange}
              className="mt-0.5"
            />
            <Label htmlFor="confirmacao-revisao" className="text-sm text-gray-700 cursor-pointer">
              Confirmo que revisei todas as informações da matrícula.
            </Label>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

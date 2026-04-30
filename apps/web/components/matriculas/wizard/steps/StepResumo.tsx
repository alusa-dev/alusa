import { useMemo } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { WizardContextValue } from '../types';
import {
  calcularValorDescontoBeneficio,
  calcularValorLiquidoComBeneficio,
  descreverBeneficioSelecionado,
} from '../beneficios';

interface StepResumoProps {
  ctx: WizardContextValue;
}

export function StepResumo({ ctx }: StepResumoProps) {
  const { state, update } = ctx;

  // Familiar mode
  if (state.modoMatricula === 'FAMILIAR') {
    return <StepResumoFamiliar ctx={ctx} />;
  }

  // Individual mode (original)
  return <StepResumoIndividual ctx={ctx} />;
}

function StepResumoFamiliar({ ctx }: StepResumoProps) {
  const { state, update } = ctx;

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

  const totalTaxas = (state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0)) * state.alunosFamiliares.length;
  const totalMensalidades = valorMensalidadeLiquido * state.alunosFamiliares.length;

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
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-violet-500 mb-1">
              Responsável financeiro
            </p>
            <p className="text-sm font-semibold text-violet-900">{state.responsavelFamiliar.nome}</p>
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
              state.modoTurmas === 'COMBO'
                ? aluno.comboLabel ?? '—'
                : aluno.turmaLabel ?? '—';

            return (
              <div
                key={aluno.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
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
                  <p className="text-xs text-slate-500">Mensalidade</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {formatter.format(valorMensalidadeLiquido)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Totais */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Taxa de matrícula (total)</span>
            <span className="font-medium">{formatter.format(totalTaxas)}</span>
          </div>
          {beneficioDescricao && (
            <div className="flex justify-between text-green-700">
              <span>Desconto ({beneficioDescricao})</span>
              <span>- {formatter.format(valorBeneficio * state.alunosFamiliares.length)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-slate-900 border-t pt-1.5">
            <span>Total mensalidades</span>
            <span>{formatter.format(totalMensalidades)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Forma de pagamento</span>
            <span>{formaPagamentoLabel(state.formaPagamento)}</span>
          </div>
          {state.dataInicio && (
            <div className="flex justify-between text-xs text-slate-500">
              <span>Início</span>
              <span>
                {new Date(state.dataInicio).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>

        {/* Confirmação */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="confirmacao-revisao-familiar"
              checked={state.confirmacaoRevisao}
              onCheckedChange={handleConfirmacaoChange}
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

  const valorMensalidade = state.modoTurmas === 'COMBO'
    ? (state.comboValor ?? 0)
    : (state.planoValor ?? 0);
  const valorBeneficio = calcularValorDescontoBeneficio(valorMensalidade, state.beneficioSelecionado);
  const valorMensalidadeLiquido = calcularValorLiquidoComBeneficio(
    valorMensalidade,
    state.beneficioSelecionado,
  );
  const beneficioDescricao = descreverBeneficioSelecionado(state.beneficioSelecionado);

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
        {/* Box Aluno + Plano */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Aluno */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
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
          </div>

          {/* Plano/Combo */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <div className="space-y-1 text-sm">
              <p className="text-gray-600">
                {state.modoTurmas === 'COMBO' ? 'Combo selecionado' : 'Plano selecionado'}:{' '}
                <span className="font-semibold text-gray-900">
                  {state.modoTurmas === 'COMBO' ? state.comboLabel : state.planoLabel}
                </span>
              </p>
              {state.modeloId && (
                <p className="text-gray-600">
                  Modelo:{' '}
                  <span className="font-medium text-gray-900">
                    {state.modeloNome || 'Selecionado'}
                  </span>
                </p>
              )}
              <p className="text-gray-600">
                Pagamento: <span className="font-medium text-gray-900">{formaPagamentoLabel(state.formaPagamento)}</span>
              </p>
              {turmaId && (
                <p className="text-gray-600">
                  Turma: <span className="font-medium text-gray-900">{state.turmaLabel || turmaId}</span>
                </p>
              )}
              <p className="text-gray-600">
                Início: <span className="font-medium text-gray-900">{state.dataInicio ? new Date(state.dataInicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}</span>
              </p>
              {state.dataFimContrato && (
                <p className="text-gray-600">
                  Fim: <span className="font-medium text-gray-900">{new Date(state.dataFimContrato).toLocaleDateString('pt-BR')}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Box Taxa de Matrícula + Box Mensalidade */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Taxa de Matrícula */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Taxa de Matrícula</h3>
            <div className="space-y-1 text-sm">
              <p className="text-gray-600">
                Valor:{' '}
                <span className="font-semibold text-gray-900">
                  {state.taxaIsenta ? 'Isenta' : formatter.format(state.taxaMatricula ?? 0)}
                </span>
              </p>
              {!state.taxaIsenta && state.formaPagamentoTaxa && (
                <p className="text-gray-600">
                  Pagamento: <span className="font-medium text-gray-900">{formaPagamentoLabel(state.formaPagamentoTaxa)}</span>
                </p>
              )}
              {state.taxaIsenta && state.taxaJustificativa && (
                <p className="text-gray-600">
                  Justificativa: <span className="font-medium text-gray-900">{state.taxaJustificativa}</span>
                </p>
              )}
            </div>
          </div>

          {/* Mensalidade */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Mensalidade</h3>
            <div className="space-y-1 text-sm">
              <p className="text-gray-600">
                Valor:{' '}
                <span className="font-semibold text-gray-900">
                  {formatter.format(valorMensalidadeLiquido)}
                </span>
              </p>
              {beneficioDescricao && (
                <p className="text-gray-600">
                  Benefício:{' '}
                  <span className="font-medium text-gray-900">
                    {beneficioDescricao} (-{formatter.format(valorBeneficio)})
                  </span>
                </p>
              )}
              <p className="text-gray-600">
                Pagamento: <span className="font-medium text-gray-900">{formaPagamentoLabel(state.formaPagamento)}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Box Configurações de Cobrança - só se houver */}
        {(temMulta || temJuros || temDesconto) && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Configurações de cobrança</h3>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              {temMulta && (
                <p className="text-gray-600">
                  Multa: <span className="font-medium text-gray-900">{state.multaPercentual}%</span>
                </p>
              )}
              {temJuros && (
                <p className="text-gray-600">
                  Juros: <span className="font-medium text-gray-900">{state.jurosMensal}% a.m.</span>
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

        {state.notificationChannelsConfigured && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
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
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="confirmacao-revisao"
              checked={state.confirmacaoRevisao}
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

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import type { WizardContextValue } from '../types';
import {
  calcularValorDescontoBeneficio,
  calcularValorLiquidoComBeneficio,
  descreverBeneficioSelecionado,
  trimTrailingZeros,
} from '../beneficios';

interface DiscountListItem {
  id: string;
  nome: string;
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
  escopo: string;
}

interface StepBolsaBeneficiosProps {
  ctx: WizardContextValue;
  contaId?: string;
}

function isBeneficioAplicavelAoWizard(escopo: string) {
  const normalized = escopo.trim().toUpperCase();
  return ['MATRICULA', 'MENSALIDADE', 'GERAL', 'ASSINATURA'].includes(normalized);
}

function parsePositiveNumber(raw: string) {
  const normalized = raw.replace(',', '.').trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

export function StepBolsaBeneficios({ ctx, contaId }: StepBolsaBeneficiosProps) {
  const { state, update } = ctx;
  const [beneficiosDisponiveis, setBeneficiosDisponiveis] = useState<DiscountListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoTipo, setNovoTipo] = useState<'FIXO' | 'PERCENTUAL'>('PERCENTUAL');
  const [novoValor, setNovoValor] = useState('');

  const formatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    [],
  );

  const valorBase = state.modoTurmas === 'COMBO'
    ? (state.comboValor ?? 0)
    : (state.planoValor ?? 0);

  const modoBeneficio = state.modoBeneficio ?? (state.beneficioSelecionado ? 'COM' : 'SEM');
  const selectedId = state.beneficioSelecionado?.id ?? null;
  const valorDesconto = calcularValorDescontoBeneficio(valorBase, state.beneficioSelecionado);
  const valorLiquido = calcularValorLiquidoComBeneficio(valorBase, state.beneficioSelecionado);
  const descricaoBeneficio = descreverBeneficioSelecionado(state.beneficioSelecionado);

  const resetCreateForm = useCallback(() => {
    setNovoNome('');
    setNovoTipo('PERCENTUAL');
    setNovoValor('');
  }, []);

  const loadBeneficios = useCallback(async () => {
    if (!contaId) return [] as DiscountListItem[];

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/descontos', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (json as { error?: { message?: string } } | null)?.error?.message ||
            'Não foi possível carregar benefícios.',
        );
      }

      const items = Array.isArray((json as { items?: unknown[] } | null)?.items)
        ? ((json as { items: unknown[] }).items as Record<string, unknown>[])
        : [];

      const mapped = items
        .map<DiscountListItem>((item) => ({
          id: String(item.id ?? ''),
          nome: String(item.nome ?? 'Benefício'),
          tipo: item.tipo === 'FIXO' ? 'FIXO' : 'PERCENTUAL',
          valor: Number(item.valor ?? 0),
          escopo: String(item.escopo ?? 'MATRICULA'),
        }))
        .filter((item) => item.id && isBeneficioAplicavelAoWizard(item.escopo));

      setBeneficiosDisponiveis(mapped);
      return mapped;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar benefícios.',
      );
      setBeneficiosDisponiveis([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [contaId]);

  useEffect(() => {
    void loadBeneficios();
  }, [loadBeneficios]);

  useEffect(() => {
    if (modoBeneficio !== 'COM') return;
    if (!state.beneficioSelecionado) return;

    const benefitStillExists = beneficiosDisponiveis.some(
      (beneficio) => beneficio.id === state.beneficioSelecionado?.id,
    );

    if (!benefitStillExists) {
      update({ beneficioSelecionado: null });
    }
  }, [beneficiosDisponiveis, modoBeneficio, state.beneficioSelecionado, update]);

  const handleSelectModo = (modo: 'SEM' | 'COM') => {
    update({
      modoBeneficio: modo,
      beneficioSelecionado: modo === 'SEM' ? null : state.beneficioSelecionado ?? null,
    });
  };

  const handleSelectBeneficio = (beneficio: DiscountListItem) => {
    update({
      modoBeneficio: 'COM',
      beneficioSelecionado: {
        ...beneficio,
        origem: 'CATALOGO',
      },
    });
  };

  const handleCreateBeneficio = async () => {
    if (!contaId) {
      toast.error('Conta não identificada.');
      return;
    }

    const nome = novoNome.trim();
    const valor = parsePositiveNumber(novoValor);

    if (nome.length < 2) {
      toast.error('Informe um nome para o benefício.');
      return;
    }

    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error('Informe um valor válido para o benefício.');
      return;
    }

    if (novoTipo === 'PERCENTUAL' && valor > 100) {
      toast.error('O benefício percentual não pode ser maior que 100%.');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/descontos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          tipo: novoTipo,
          valor,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (json as { error?: { message?: string } } | null)?.error?.message ||
            'Não foi possível cadastrar o benefício.',
        );
      }

      const created = (json as { item?: DiscountListItem } | null)?.item;
      const refreshed = await loadBeneficios();
      const selected = refreshed.find((item) => item.id === created?.id) ?? created;

      if (selected) {
        handleSelectBeneficio(selected);
      }

      resetCreateForm();
      setCreateModalOpen(false);
      toast.success('Benefício cadastrado.');
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : 'Não foi possível cadastrar o benefício.',
      );
    } finally {
      setCreating(false);
    }
  };

  const selectedBenefitLabel = state.beneficioSelecionado
    ? state.beneficioSelecionado.tipo === 'PERCENTUAL'
      ? `${trimTrailingZeros(state.beneficioSelecionado.valor)}%`
      : formatter.format(state.beneficioSelecionado.valor)
    : null;

  return (
    <>
      <SectionCard>
        <StepHeader
          title="Bolsa e Benefícios"
          hint="Defina se a matrícula seguirá com valor cheio ou se usará um benefício já cadastrado na conta."
        />

        <div className="space-y-4">
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Como esta matrícula será tratada</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleSelectModo('SEM')}
                  className={`rounded-xl border p-4 text-left transition ${
                    modoBeneficio === 'SEM'
                      ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-sm font-semibold">Sem benefício</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    A matrícula seguirá com o valor cheio do plano ou combo.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectModo('COM')}
                  className={`rounded-xl border p-4 text-left transition ${
                    modoBeneficio === 'COM'
                      ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-sm font-semibold">Com benefício</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Escolha um benefício ativo da conta para aplicar nesta matrícula.
                  </span>
                </button>
              </div>
            </div>

            {modoBeneficio === 'COM' && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Benefícios cadastrados</h3>
                    <p className="text-xs text-gray-500">
                      Selecione um benefício ativo da conta para aplicar nesta matrícula.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {loading && <span className="text-xs text-gray-400">Carregando…</span>}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={() => setCreateModalOpen(true)}
                    >
                      Cadastrar
                    </Button>
                  </div>
                </div>

                {error ? (
                  <p className="text-sm text-amber-700">{error}</p>
                ) : beneficiosDisponiveis.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      Nenhum benefício ativo cadastrado.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Cadastre o primeiro benefício para disponibilizá-lo nesta matrícula.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {beneficiosDisponiveis.map((beneficio) => {
                      const active = selectedId === beneficio.id;
                      const valorLabel = beneficio.tipo === 'PERCENTUAL'
                        ? `${trimTrailingZeros(beneficio.valor)}%`
                        : formatter.format(beneficio.valor);

                      return (
                        <button
                          key={beneficio.id}
                          type="button"
                          onClick={() => handleSelectBeneficio(beneficio)}
                          className={`rounded-xl border p-4 text-left transition ${
                            active
                              ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="text-sm font-semibold">{beneficio.nome}</span>
                              <span className="mt-1 block text-xs text-gray-500">
                                {beneficio.tipo === 'PERCENTUAL' ? 'Percentual' : 'Valor fixo'}
                              </span>
                            </div>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                              {valorLabel}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Resumo financeiro
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Visualize o impacto do benefício antes de avançar.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs text-gray-600">Valor base</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{formatter.format(valorBase)}</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs text-gray-600">Benefício aplicado</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {modoBeneficio === 'SEM'
                      ? 'Nenhum benefício aplicado'
                      : descricaoBeneficio ?? 'Selecione um benefício'}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    {modoBeneficio === 'COM' && selectedBenefitLabel
                      ? `Condição atual: ${selectedBenefitLabel}`
                      : 'Desconto estimado: R$ 0,00'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Desconto estimado: {formatter.format(valorDesconto)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">
                    Mensalidade líquida
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{formatter.format(valorLiquido)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <Dialog
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open && !creating) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-xl rounded-2xl border border-slate-200 bg-white p-0">
          <DialogHeader className="border-b border-slate-100 px-6 py-5">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              Cadastrar benefício
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-600">
              O benefício criado ficará disponível para esta e para próximas matrículas da conta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Nome do benefício
              </label>
              <Input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex.: Bolsa 50% ou Convênio escola"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Tipo
                </label>
                <Tabs
                  value={novoTipo}
                  onValueChange={(value) => setNovoTipo(value as 'FIXO' | 'PERCENTUAL')}
                >
                  <TabsList className="h-10 rounded-xl bg-slate-100/80 p-1">
                    <TabsTrigger value="PERCENTUAL" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">
                      %
                    </TabsTrigger>
                    <TabsTrigger value="FIXO" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">
                      R$
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Valor
                </label>
                <Input
                  value={novoValor}
                  onChange={(e) => setNovoValor(e.target.value)}
                  inputMode="decimal"
                  placeholder={novoTipo === 'PERCENTUAL' ? 'Ex.: 50' : 'Ex.: 75,00'}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-100 px-6 py-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (creating) return;
                setCreateModalOpen(false);
                resetCreateForm();
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateBeneficio()}
              disabled={creating}
              className="bg-brand-accent text-white hover:bg-brand-accent/90"
            >
              {creating ? 'Salvando...' : 'Cadastrar benefício'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

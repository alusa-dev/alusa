'use client';

import { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { pushToast } from '@/components/ui/toast';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import useCurrentUser from '@/hooks/use-current-user';
import { usePlanos } from '@/features/cadastro/planos/hooks/use-planos';
import { useTurmas } from '@/features/cadastro/turmas/hooks/use-turmas';

interface DadosPlanoProps {
  matriculaId: string;
  onRefresh: () => void;
  asaasSubscriptionId?: string | null;
  plano?: {
    id?: string;
    nome: string;
    valor: number;
    periodicidade: string;
  } | null;
  turma?: {
    id?: string;
    nome: string;
    horaInicio: string;
    horaFim: string;
    diasSemana: string[];
  } | null;
  combo?: {
    id?: string;
    nome: string;
    valor?: number;
    periodicidade?: string;
  } | null;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const editButtonClass = 'h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed';

export function DadosPlano({ matriculaId, onRefresh, asaasSubscriptionId, plano, turma, combo }: DadosPlanoProps) {
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items: planosDisponiveis, loading: planosLoading } = usePlanos({ contaId });
  const { items: turmasDisponiveis, loading: turmasLoading } = useTurmas({ contaId });

  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [planoIdSelecionado, setPlanoIdSelecionado] = useState(plano?.id ?? '');
  const [turmaIdSelecionado, setTurmaIdSelecionado] = useState(turma?.id ?? '');

  useEffect(() => {
    if (editando) return;
    setPlanoIdSelecionado(plano?.id ?? '');
    setTurmaIdSelecionado(turma?.id ?? '');
  }, [editando, plano?.id, turma?.id]);

  const planoSelecionado = useMemo(() => {
    return planosDisponiveis.find((item) => item.id === planoIdSelecionado) ??
      (plano?.id ? { ...plano, id: plano.id, contaId: contaId ?? '' } : null);
  }, [planoIdSelecionado, planosDisponiveis, plano, contaId]);

  const turmaSelecionada = useMemo(() => {
    return turmasDisponiveis.find((item) => item.id === turmaIdSelecionado) ??
      (turma?.id
        ? {
            ...turma,
            id: turma.id,
            contaId: contaId ?? '',
            status: 'ATIVO',
            capacidade: 0,
            vagasOcupadas: 0,
            modalidadeId: '',
            salaId: '',
            professores: [],
            professoresCount: 0,
            descricao: null,
          }
        : null);
  }, [turmaIdSelecionado, turmasDisponiveis, turma, contaId]);

  const turmaLotada = useMemo(() => {
    if (!turmaIdSelecionado) return false;
    const encontrada = turmasDisponiveis.find((t) => t.id === turmaIdSelecionado);
    if (!encontrada) return false;
    return encontrada.vagasOcupadas >= encontrada.capacidade;
  }, [turmaIdSelecionado, turmasDisponiveis]);

  const nomeProduto = planoSelecionado?.nome ?? combo?.nome ?? 'Não definido';
  const valorProduto = planoSelecionado?.valor ?? combo?.valor ?? 0;
  const periodicidadeProduto = planoSelecionado?.periodicidade ?? combo?.periodicidade ?? '—';
  const tipoProduto = planoSelecionado ? 'Plano' : combo ? 'Combo' : 'Produto';

  const handleCancelar = () => {
    setPlanoIdSelecionado(plano?.id ?? '');
    setTurmaIdSelecionado(turma?.id ?? '');
    setEditando(false);
  };

  const handleSalvar = async () => {
    if (!contaId) {
      pushToast({ title: 'Conta não encontrada', description: 'Faça login novamente.', variant: 'error' });
      return;
    }
    if (!planoIdSelecionado) {
      pushToast({ title: 'Selecione um plano', description: 'Escolha o plano antes de salvar.', variant: 'warning' });
      return;
    }
    if (!turmaIdSelecionado) {
      pushToast({ title: 'Selecione a turma', description: 'Escolha a turma antes de salvar.', variant: 'warning' });
      return;
    }
    if (turmaLotada) {
      pushToast({ title: 'Turma lotada', description: 'Escolha outra turma com vagas disponíveis.', variant: 'warning' });
      return;
    }

    setSalvando(true);
    try {
      const res = await fetch(`/api/matriculas/${matriculaId}/editar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contaId,
          turmaId: turmaIdSelecionado,
          planoId: planoIdSelecionado,
          comboId: combo?.id ?? null,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (data as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao salvar edição';
        throw new Error(message);
      }

      pushToast({
        title: 'Matrícula atualizada',
        description:
          (data as { asyncSync?: { message?: string } } | null)?.asyncSync?.message ||
          'Plano e turma atualizados com sucesso.',
        variant: 'success',
      });
      setEditando(false);
      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao editar matrícula',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className={sectionClass}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-slate-700">{tipoProduto} e Turma</span>
        {editando ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-600"
              disabled={salvando}
              onClick={handleCancelar}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSalvar} disabled={salvando || planosLoading || turmasLoading}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={editButtonClass}
            onClick={() => setEditando(true)}
          >
            Editar
          </Button>
        )}
      </div>

      {asaasSubscriptionId ? (
        <InfoCallout size="sm">
          <InfoCalloutItem label="Sincronização financeira" labelTone="default">
            ao trocar o plano, a régua financeira da Alusa atualiza o valor recorrente para manter coerência
            entre matrícula, plano e cobrança.
          </InfoCalloutItem>
        </InfoCallout>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Plano ou Combo */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className={labelClass}>Nome do {tipoProduto}</label>
            {editando && !combo ? (
              <Select
                value={planoIdSelecionado}
                onValueChange={(value) => setPlanoIdSelecionado(value)}
                disabled={planosLoading || salvando}
              >
                <SelectTrigger className={controlClass}>
                  <SelectValue placeholder="Selecione o plano" />
                </SelectTrigger>
                <SelectContent>
                  {planosDisponiveis
                    .filter((item) => item.status === 'ATIVO')
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.nome} · {currency.format(item.valor)} · {item.periodicidade}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={nomeProduto} disabled className={controlClass} />
            )}
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Valor</label>
            <Input
              value={currency.format(valorProduto)}
              disabled
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-lg font-bold text-slate-900 shadow-sm disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Periodicidade</label>
            <Input value={periodicidadeProduto} disabled className={controlClass} />
          </div>
        </div>

        {/* Turma */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className={labelClass}>Turma</label>
            {editando ? (
              <Select
                value={turmaIdSelecionado}
                onValueChange={(value) => setTurmaIdSelecionado(value)}
                disabled={turmasLoading || salvando}
              >
                <SelectTrigger className={controlClass}>
                  <SelectValue placeholder="Selecione a turma" />
                </SelectTrigger>
                <SelectContent>
                  {turmasDisponiveis
                    .filter((item) => item.status === 'ATIVO')
                    .map((item) => {
                      const lotada = item.vagasOcupadas >= item.capacidade;
                      const ocupacaoLabel = `${item.vagasOcupadas}/${item.capacidade}`;
                      return (
                        <SelectItem key={item.id} value={item.id} disabled={lotada}>
                          {item.nome} · {item.horaInicio}-{item.horaFim} · {item.diasSemana.join(', ')}
                          {` · ${ocupacaoLabel}${lotada ? ' (lotada)' : ''}`}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={turmaSelecionada?.nome ?? (combo ? 'Ver detalhes do combo' : 'Sem turma vinculada')}
                disabled
                className={controlClass}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={labelClass}>Horário</label>
              <Input
                value={
                  turmaSelecionada
                    ? `${turmaSelecionada.horaInicio} - ${turmaSelecionada.horaFim}`
                    : '—'
                }
                disabled
                className={controlClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Dias</label>
              <Input
                value={turmaSelecionada ? turmaSelecionada.diasSemana.join(', ') : '—'}
                disabled
                className={controlClass}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

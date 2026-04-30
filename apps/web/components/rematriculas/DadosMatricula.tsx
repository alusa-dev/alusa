'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PencilIcon } from '@heroicons/react/24/outline';
import { pushToast } from '@/components/ui/toast';
import { Badge, type StatusType } from '@/components/ui/badge';
import { StatusMatricula } from '@prisma/client';

interface DadosMatriculaProps {
  matriculaId: string;
  matricula: {
    status: StatusMatricula;
    dataInicio: string;
    dataFim?: string | null;
    vencimentoDia: number;
    asaasSubscriptionId?: string | null;
  };
  pausaResumo?: unknown;
  cobrancas?: unknown[];
  onRefresh: () => void;
}

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const editButtonClass = 'h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed';

export function DadosMatricula({ matriculaId, matricula, onRefresh }: DadosMatriculaProps) {
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [dataInicio, setDataInicio] = useState(
    new Date(matricula.dataInicio).toISOString().slice(0, 10)
  );
  const [vencimentoDia, setVencimentoDia] = useState(matricula.vencimentoDia.toString());

  const handleCancelar = useCallback(() => {
    setDataInicio(new Date(matricula.dataInicio).toISOString().slice(0, 10));
    setVencimentoDia(matricula.vencimentoDia.toString());
    setEditando(false);
  }, [matricula]);

  const handleSalvar = useCallback(async () => {
    try {
      setSalvando(true);

      const payload: Record<string, unknown> = {};

      if (dataInicio !== new Date(matricula.dataInicio).toISOString().slice(0, 10)) {
        payload.dataInicio = new Date(dataInicio).toISOString();
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
  }, [matriculaId, matricula, dataInicio, vencimentoDia, onRefresh]);

  return (
    <div className={sectionClass}>
      <div className="flex items-start justify-between mb-4">
        <span className="text-sm font-semibold text-slate-700">Informações da Matrícula</span>
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
              disabled={salvando}
              className="bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90"
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className={labelClass}>Status</label>
          <div className="mt-1">
            <Badge status={matricula.status as StatusType} />
          </div>
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Data de Início</label>
          <Input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            disabled={!editando}
            className={controlClass}
          />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Dia de Vencimento</label>
          <Select
            value={vencimentoDia}
            onValueChange={setVencimentoDia}
            disabled={!editando}
          >
            <SelectTrigger className="h-10 w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-900 shadow-sm focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed">
              <SelectValue placeholder="Selecione o dia" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((dia) => (
                <SelectItem key={dia} value={dia.toString()}>
                  Dia {dia}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            {matricula.asaasSubscriptionId
              ? 'Este campo conversa com a régua financeira da Alusa. A alteração vale para os próximos ciclos e pode ajustar cobranças ainda editáveis.'
              : 'Sem vínculo financeiro ativo, este campo permanece apenas no cadastro local da matrícula.'}
          </p>
        </div>
      </div>
    </div>
  );
}

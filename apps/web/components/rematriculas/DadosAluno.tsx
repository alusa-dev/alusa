'use client';

import { Input } from '@/components/ui/input';

interface DadosAlunoProps {
  aluno: {
    id: string;
    nome: string;
    cpf?: string | null;
    email?: string | null;
    telefone?: string | null;
  };
  responsavelFinanceiro?: {
    nome: string;
    email?: string | null;
    telefone?: string | null;
  } | null;
}

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const inputDisabledClass = 'h-10 w-full rounded-lg border border-gray-200 bg-gray-100 px-3 text-sm text-gray-500 shadow-none disabled:opacity-100 disabled:cursor-not-allowed';

export function DadosAluno({ aluno, responsavelFinanceiro }: DadosAlunoProps) {
  return (
    <div className={sectionClass}>
      <span className="text-sm font-semibold text-slate-700">Dados do Aluno</span>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelClass}>Nome Completo</label>
          <Input
            value={aluno.nome}
            disabled
            className={inputDisabledClass}
            readOnly
          />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>CPF</label>
          <Input
            value={aluno.cpf ? aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : ''}
            disabled
            className={inputDisabledClass}
            placeholder="Não informado"
            readOnly
          />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>E-mail</label>
          <Input
            type="email"
            value={aluno.email || ''}
            disabled
            className={inputDisabledClass}
            placeholder="Não informado"
            readOnly
          />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Telefone</label>
          <Input
            value={aluno.telefone || ''}
            disabled
            className={inputDisabledClass}
            placeholder="Não informado"
            readOnly
          />
        </div>
      </div>

      {responsavelFinanceiro && (
        <div className="border-t border-slate-200 pt-4">
          <span className="text-sm font-semibold text-slate-700">Responsável financeiro</span>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <label className={labelClass}>Nome</label>
              <Input value={responsavelFinanceiro.nome} disabled className={inputDisabledClass} readOnly />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>E-mail</label>
              <Input
                type="email"
                value={responsavelFinanceiro.email || ''}
                disabled
                className={inputDisabledClass}
                placeholder="Não informado"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Telefone</label>
              <Input
                value={responsavelFinanceiro.telefone || ''}
                disabled
                className={inputDisabledClass}
                placeholder="Não informado"
                readOnly
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

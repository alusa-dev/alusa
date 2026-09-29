'use client';

import { User, Users } from '@/components/icons/icons';
import { SectionCard, StepHeader } from '@/components/shared/wizard/layout';
import { cn } from '@/lib/utils';
import type { ModoMatricula, WizardContextValue } from '../types';

interface StepEnrollmentModeProps {
  ctx: WizardContextValue;
}

interface ModoOption {
  valor: ModoMatricula;
  titulo: string;
  descricao: string;
  icon: React.ElementType;
}

const OPCOES: ModoOption[] = [
  {
    valor: 'INDIVIDUAL',
    titulo: 'Individual',
    descricao: 'Matrícula de um único aluno com suas próprias configurações.',
    icon: User,
  },
  {
    valor: 'FAMILIAR',
    titulo: 'Familiar',
    descricao: 'Matricule irmãos vinculados ao mesmo responsável financeiro.',
    icon: Users,
  },
];

export function StepEnrollmentMode({ ctx }: StepEnrollmentModeProps) {
  const { state, update, goNext } = ctx;

  const handleSelect = (valor: ModoMatricula) => {
    update({
      modoMatricula: valor,
      // Limpar campos do modo anterior ao trocar
      aluno: undefined,
      responsavelFamiliar: undefined,
      alunosFamiliares: [],
    });
    goNext();
  };

  return (
    <SectionCard>
      <StepHeader title="Tipo de matrícula" hint="Escolha como deseja prosseguir com o cadastro." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {OPCOES.map(({ valor, titulo, descricao, icon: Icon }) => {
          const ativo = state.modoMatricula === valor;
          return (
            <button
              key={valor}
              type="button"
              data-testid={`modo-${valor.toLowerCase()}`}
              onClick={() => handleSelect(valor)}
              className={cn(
                'flex flex-col gap-2 rounded-[10px] border p-4 text-left transition-colors',
                ativo
                  ? 'border-transparent bg-[#eee6f8] text-slate-900'
                  : 'border-slate-200 bg-white text-slate-900 hover:bg-[#e7edf5]',
              )}
            >
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full',
                  ativo ? 'bg-[#dfcff5] text-[#512a82]' : 'bg-slate-100 text-slate-500',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p
                  className={cn(
                    'text-sm font-semibold',
                    ativo ? 'text-gray-900' : 'text-slate-800',
                  )}
                >
                  {titulo}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>
              </div>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

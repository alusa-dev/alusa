'use client';

import { User, Users } from '@/components/icons/icons';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { cn } from '@/lib/utils';
import type { ModoMatricula, WizardContextValue } from '../types';

interface StepModoMatriculaProps {
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

export function StepModoMatricula({ ctx }: StepModoMatriculaProps) {
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
      <StepHeader
        title="Tipo de matrícula"
        hint="Escolha como deseja prosseguir com o cadastro."
      />

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
                'flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:border-violet-400 hover:bg-violet-50/50',
                ativo
                  ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500'
                  : 'border-slate-200 bg-white',
              )}
            >
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full',
                  ativo ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p
                  className={cn(
                    'text-sm font-semibold',
                    ativo ? 'text-violet-900' : 'text-slate-800',
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

'use client';

import { ArrowUpRightIcon } from '@heroicons/react/24/outline';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { formatInitials } from '@alusa/lib/client';

export interface AlunoContratoCardData {
  id: string;
  nome: string;
  foto: string | null;
}

interface AlunoContratoCardProps {
  aluno: AlunoContratoCardData;
  onClick: (_alunoId: string) => void;
  className?: string;
}

export function AlunoContratoCard({ aluno, onClick, className }: AlunoContratoCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(aluno.id)}
      className={cn(
        'group flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition-colors duration-200 hover:bg-gray-50',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <Avatar className="h-11 w-11">
          <AvatarImage src={aluno.foto ?? ''} alt={aluno.nome} />
          <AvatarFallback className="bg-brand-accent text-white">
            {formatInitials(aluno.nome)}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-base font-semibold text-gray-900">{aluno.nome}</p>
          <p className="text-sm text-gray-600">Ver contratos</p>
        </div>
      </div>
      <div className="flex items-center">
        <ArrowUpRightIcon className="h-5 w-5 text-gray-400 transition group-hover:text-brand-accent" />
      </div>
    </button>
  );
}

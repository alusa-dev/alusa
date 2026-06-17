'use client';

import { ArrowUpRightIcon } from '@heroicons/react/24/outline';

import { PersonAvatar } from '@/components/shared/PersonAvatar';
import type { ListNotaFiscalPersonIndexResultDTO } from '@/features/financeiro/notafiscal/dtos';
import { cn } from '@/lib/cn';

type PessoaItem = ListNotaFiscalPersonIndexResultDTO['data'][number];

type PessoaNotaFiscalCardProps = {
  pessoa: PessoaItem;
  onClick: (pessoa: PessoaItem) => void;
  className?: string;
};

export function PessoaNotaFiscalCard({ pessoa, onClick, className }: PessoaNotaFiscalCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(pessoa)}
      className={cn(
        'group flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-colors duration-200 hover:bg-gray-50 lg:gap-4 lg:rounded-2xl lg:px-5 lg:py-4',
        className,
      )}
    >
      <div className="flex items-center gap-3 lg:gap-4">
        <PersonAvatar
          name={pessoa.nome}
          src={pessoa.avatarUrl}
          className="h-10 w-10 shrink-0 lg:h-11 lg:w-11"
        />
        <div>
          <p className="text-base font-semibold text-gray-900">{pessoa.nome}</p>
          <p className="text-sm text-gray-600">Ver notas fiscais</p>
        </div>
      </div>
      <div className="flex items-center">
        <ArrowUpRightIcon className="h-5 w-5 text-gray-400 transition group-hover:text-brand-accent" />
      </div>
    </button>
  );
}

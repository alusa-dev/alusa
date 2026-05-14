'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search } from '@/components/icons/icons';
import { cn } from '@/lib/cn';
import type { TurmaListItem } from '@/features/cadastro/turmas/services/turmas-service';
import type { ContratosAlunoStatusFilter } from '../hooks/use-contratos-alunos';

interface ContratosAlunosFiltersBarProps {
  mode?: 'all' | 'search' | 'filters';
  searchValue: string;
  onSearchChange: (_v: string) => void;

  statusValue: ContratosAlunoStatusFilter;
  onStatusChange: (_v: ContratosAlunoStatusFilter) => void;

  turmaId: string;
  onTurmaChange: (_turmaId: string) => void;

  turmas: TurmaListItem[];
  turmasLoading: boolean;
  disabled?: boolean;
  className?: string;
}

export function ContratosAlunosFiltersBar({
  mode = 'all',
  searchValue,
  onSearchChange,
  statusValue,
  onStatusChange,
  turmaId,
  onTurmaChange,
  turmas,
  turmasLoading,
  disabled,
  className,
}: ContratosAlunosFiltersBarProps) {
  if (mode === 'search') {
    return (
      <div className={cn('relative w-full lg:max-w-[420px]', className)}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Buscar aluno por nome, CPF ou e-mail..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 pl-10 border border-gray-300 shadow-none"
          disabled={disabled}
        />
      </div>
    );
  }

  if (mode === 'filters') {
    return (
      <div
        className={cn(
          'grid w-full min-w-0 grid-cols-2 gap-2 lg:flex lg:flex-nowrap lg:items-center lg:justify-end lg:gap-3',
          className,
        )}
      >
        <Select value={statusValue} onValueChange={(v) => onStatusChange(v as ContratosAlunoStatusFilter)}>
          <SelectTrigger
            className="h-10 w-full min-w-0 border border-gray-300 bg-white px-3 text-gray-700 shadow-none lg:w-auto lg:min-w-[190px]"
            disabled={disabled}
          >
            <SelectValue placeholder="Status do contrato" />
          </SelectTrigger>
          <SelectContent align="end" className="text-[13px]">
            <SelectItem value="TODOS">Todos os status</SelectItem>
            <SelectItem value="PENDENTE">Pendente</SelectItem>
            <SelectItem value="ASSINADO">Assinado</SelectItem>
            <SelectItem value="EXPIRADO">Expirado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={turmaId || 'TODAS'}
          onValueChange={(v) => onTurmaChange(v === 'TODAS' ? '' : v)}
          disabled={disabled || turmasLoading}
        >
          <SelectTrigger className="h-10 w-full min-w-0 border border-gray-300 bg-white px-3 text-gray-700 shadow-none lg:w-auto lg:min-w-[220px]">
            <SelectValue placeholder="Todas as turmas" />
          </SelectTrigger>
          <SelectContent align="end" className="text-[13px]">
            <SelectItem value="TODAS">Todas as turmas</SelectItem>
            {turmas.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between',
        className,
      )}
    >
      <div className="relative w-full lg:max-w-[420px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Buscar aluno por nome, CPF ou e-mail..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 pl-10 border border-gray-300 shadow-none"
          disabled={disabled}
        />
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 gap-2 lg:flex lg:flex-nowrap lg:items-center lg:justify-end lg:gap-3">
        <Select value={statusValue} onValueChange={(v) => onStatusChange(v as ContratosAlunoStatusFilter)}>
          <SelectTrigger
            className="h-10 w-full min-w-0 border border-gray-300 bg-white px-3 text-gray-700 shadow-none lg:w-auto lg:min-w-[190px]"
            disabled={disabled}
          >
            <SelectValue placeholder="Status do contrato" />
          </SelectTrigger>
          <SelectContent align="end" className="text-[13px]">
            <SelectItem value="TODOS">Todos os status</SelectItem>
            <SelectItem value="PENDENTE">Pendente</SelectItem>
            <SelectItem value="ASSINADO">Assinado</SelectItem>
            <SelectItem value="EXPIRADO">Expirado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={turmaId || 'TODAS'}
          onValueChange={(v) => onTurmaChange(v === 'TODAS' ? '' : v)}
          disabled={disabled || turmasLoading}
        >
          <SelectTrigger className="h-10 w-full min-w-0 border border-gray-300 bg-white px-3 text-gray-700 shadow-none lg:w-auto lg:min-w-[220px]">
            <SelectValue placeholder="Todas as turmas" />
          </SelectTrigger>
          <SelectContent align="end" className="text-[13px]">
            <SelectItem value="TODAS">Todas as turmas</SelectItem>
            {turmas.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

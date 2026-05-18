"use client";

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { AvatarGroup } from '@/components/shared/AvatarGroup';

import { DASHBOARD_KPI_TILE_CLASSNAME } from './utils';

type RecentStudentInput = {
  id: string;
  nome?: string;
  name?: string;
  foto?: string | null;
  avatarUrl?: string | null;
};

type TotalAlunosCardProps = {
  total: number;
  ativos?: number;
  recentes?: RecentStudentInput[];
  recentStudents?: RecentStudentInput[];
  onAddAluno: () => void;
  disableAddAluno?: boolean;
  loading?: boolean;
};

const cardSurface = `${DASHBOARD_KPI_TILE_CLASSNAME} flex flex-col min-h-[220px] rounded-2xl bg-[#e6d6fb] px-5 py-4 text-[#2b2634] alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)] alusa-dark:text-[color:var(--color-text-primary)]`;

export function TotalAlunosCard({
  total,
  recentes,
  recentStudents,
  onAddAluno,
  disableAddAluno = false,
  loading = false,
}: TotalAlunosCardProps) {
  if (loading) {
    return (
      <div
        className={`${cardSurface} animate-pulse`}
        data-testid="total-alunos-card"
        aria-label="Resumo do total de alunos"
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24 bg-white/50 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
          <Skeleton className="h-7 w-24 rounded-full bg-white/45 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <Skeleton className="h-12 w-16 bg-white/50 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full bg-white/45 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
            <Skeleton className="h-9 w-9 rounded-full bg-white/45 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
            <Skeleton className="h-9 w-9 rounded-full bg-white/45 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full bg-white/50 alusa-dark:bg-[color:var(--color-border-strong)]/35" />
        </div>
      </div>
    );
  }

  const normalizedRecent = (recentes ?? recentStudents ?? []).map((student) => {
    const name = student.name ?? student.nome ?? 'Aluno recente';
    return {
      id: student.id,
      name,
      src: student.avatarUrl ?? student.foto ?? null,
    };
  });

  const hasRecentStudents = normalizedRecent.length > 0;

  return (
    <div
      className={cardSurface}
      data-testid="total-alunos-card"
      aria-label="Resumo do total de alunos"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-[13px] font-normal tracking-wide text-[#2b2634] alusa-dark:text-[color:var(--color-text-secondary)]">
            Alunos ativos
          </span>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#2b2634]/5 px-3 py-1 text-xs font-medium text-[#2b2634] alusa-dark:bg-[color:rgba(195,163,235,0.16)] alusa-dark:text-[color:var(--color-text-secondary)]">
          <span className="h-2 w-2 rounded-full bg-[#38C256]" aria-hidden />
          Atualizado
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <span className="text-5xl font-medium leading-none text-[#2b2634] alusa-dark:text-[color:var(--color-text-primary)]">
          {total}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          {hasRecentStudents ? (
            <AvatarGroup
              items={normalizedRecent}
              max={3}
              size="sm"
              fallbackClassName="bg-gradient-to-br from-purple-500 to-pink-500 text-white alusa-dark:from-purple-600 alusa-dark:to-pink-600 alusa-dark:text-white"
            />
          ) : (
            <span className="text-xs text-[#2b2634]/80 alusa-dark:text-[color:var(--color-text-muted)]">
              Sem cadastros recentes
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={disableAddAluno ? undefined : onAddAluno}
          disabled={disableAddAluno}
          title={disableAddAluno ? 'Conclua seu cadastro para cadastrar alunos.' : undefined}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-current text-xl font-semibold text-black transition focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/35 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-40 alusa-dark:border-[color:var(--color-brand-400)] alusa-dark:text-[color:var(--color-brand-300)] alusa-dark:focus-visible:ring-[color:var(--color-brand-400)]"
          aria-label="Cadastrar novo aluno"
          data-testid="add-student-btn"
        >
          +
        </button>
      </div>
    </div>
  );
}

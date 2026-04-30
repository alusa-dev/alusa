"use client";

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type RecentStudentInput = {
  id: string;
  nome?: string;
  name?: string;
  foto?: string | null;
  avatarUrl?: string | null;
};

type RecentStudent = {
  id: string;
  name: string;
  avatarUrl: string | null;
  initials: string;
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

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'AL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function TotalAlunosCard({
  total,
  ativos = 0,
  recentes,
  recentStudents,
  onAddAluno,
  disableAddAluno = false,
  loading = false,
}: TotalAlunosCardProps) {
  if (loading) {
    return (
      <div
        className="flex flex-col min-h-[220px] rounded-2xl px-5 py-4"
        style={{ backgroundColor: '#e6d6fb', color: '#2b2634' }}
        data-testid="total-alunos-card"
        aria-label="Resumo do total de alunos"
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24 bg-white/50" />
          <Skeleton className="h-7 w-24 rounded-full bg-white/45" />
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <Skeleton className="h-12 w-16 bg-white/50" />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full bg-white/45" />
            <Skeleton className="h-9 w-9 rounded-full bg-white/45" />
            <Skeleton className="h-9 w-9 rounded-full bg-white/45" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full bg-white/50" />
        </div>
      </div>
    );
  }

  const normalizedRecent: RecentStudent[] = (recentes ?? recentStudents ?? []).map((student) => {
    const name = student.name ?? student.nome ?? 'Aluno recente';
    const avatarUrl = student.avatarUrl ?? student.foto ?? null;

    return {
      id: student.id,
      name,
      avatarUrl,
      initials: getInitials(name),
    };
  });

  const avatarSlots: Array<RecentStudent | null> = [...normalizedRecent.slice(0, 3)];
  while (avatarSlots.length < 3) {
    avatarSlots.push(null);
  }

  const gradientFallback = 'bg-gradient-to-br from-purple-500 to-pink-500';
  const hasRecentStudents = normalizedRecent.length > 0;

  return (
    <div
      className="flex flex-col min-h-[220px] rounded-2xl px-5 py-4"
      style={{ backgroundColor: '#e6d6fb', color: '#2b2634' }}
      data-testid="total-alunos-card"
      aria-label="Resumo do total de alunos"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-[13px] font-normal tracking-wide" style={{ color: '#2b2634' }}>Alunos ativos</span>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#2b2634]/5 px-3 py-1 text-xs font-medium" style={{ color: '#2b2634' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#38C256' }} aria-hidden />
          Atualizado
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <span className="text-5xl font-medium leading-none" style={{ color: '#2b2634' }}>{total}</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          {hasRecentStudents ? (
            <div className="flex items-center -space-x-2">
              {avatarSlots.map((student, index) => {
                const avatarUrl = student?.avatarUrl?.trim() ?? null;
                const hasAvatar = Boolean(avatarUrl);
                const displayName = student?.name ?? 'Aluno recente';
                const displayInitials = student?.initials ?? 'AL';

                return (
                  <div
                    key={student?.id ?? `placeholder-${index}`}
                    className={`flex h-9 w-9 items-center justify-center rounded-full outline outline-4 ${hasAvatar ? 'bg-transparent' : gradientFallback} text-xs font-semibold text-white pointer-events-none select-none overflow-hidden`}
                    style={{ outlineColor: '#e6d6fb' }}
                    title={displayName}
                    data-testid="student-avatar"
                  >
                    {hasAvatar ? (
                      <img
                        src={avatarUrl!}
                        alt={displayName}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent) {
                            parent.classList.add('bg-gradient-to-br', 'from-purple-500', 'to-pink-500');
                          }
                        }}
                      />
                    ) : null}
                    {!hasAvatar && <span>{displayInitials}</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-xs text-[#2b2634] opacity-80">Sem cadastros recentes</span>
          )}
        </div>
        <button
          type="button"
          onClick={disableAddAluno ? undefined : onAddAluno}
          disabled={disableAddAluno}
          title={disableAddAluno ? 'Conclua seu cadastro para cadastrar alunos.' : undefined}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-current text-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: '#000000' }}
          aria-label="Cadastrar novo aluno"
          data-testid="add-student-btn"
        >
          +
        </button>
      </div>
    </div>
  );
}

"use client";

import { Skeleton } from '@/components/ui/skeleton';

import { DASHBOARD_KPI_TILE_CLASSNAME } from './utils';

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
            <div className="flex items-center -space-x-2">
              {avatarSlots.map((student, index) => {
                const avatarUrl = student?.avatarUrl?.trim() ?? null;
                const hasAvatar = Boolean(avatarUrl);
                const displayName = student?.name ?? 'Aluno recente';
                const displayInitials = student?.initials ?? 'AL';

                return (
                  <div
                    key={student?.id ?? `placeholder-${index}`}
                    className={`flex h-9 w-9 items-center justify-center rounded-full outline outline-4 outline-[#e6d6fb] alusa-dark:outline-[color:var(--color-bg-card-soft)] ${hasAvatar ? 'bg-transparent' : gradientFallback} pointer-events-none select-none overflow-hidden text-xs font-semibold text-white`}
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
                    {!hasAvatar ? <span>{displayInitials}</span> : null}
                  </div>
                );
              })}
            </div>
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

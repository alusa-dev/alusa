'use client';

import type { ComponentType } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CreditCard, Calendar, User, AlertCircle } from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import type { PortalDashboardResultDTO } from '@/features/portal/dtos';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { AlunoSelector } from './components/AlunoSelector';

export function PortalDashboardFeature() {
  const { data: session } = useSession();
  const [data, setData] = useState<PortalDashboardResultDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlunoId, setSelectedAlunoId] = useState<string | null>(null);

  const user = session?.user as { role?: string } | undefined;
  const isResponsavel = user?.role === 'RESPONSAVEL';

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      let url = '/api/portal/dashboard';

      // Se um aluno específico foi selecionado, adicionar como query param
      if (selectedAlunoId) {
        url += `?alunoId=${selectedAlunoId}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Erro ao carregar dados');
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedAlunoId]);

  useEffect(() => {
    if (session?.user) {
      void loadData();
    }
  }, [session?.user, loadData]);

  useLiveRefresh(
    () => loadData(true),
    {
      enabled: Boolean(session?.user) && !loading,
      intervalMs: 60_000,
      minIntervalMs: 10_000,
    },
  );

  const userName = session?.user?.name || 'Aluno';
  const greeting = getGreeting();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {greeting}, {userName}!
        </h1>
        <p className="mt-2 text-gray-600">Confira suas informações e atividades</p>
      </div>

      {/* Seletor de Aluno (apenas para responsáveis) */}
      {isResponsavel && <AlunoSelector onAlunoSelect={setSelectedAlunoId} />}

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Matrículas */}
        <Card
          title="Matrículas"
          icon={User}
          value={data?.matriculas.ativas.toString() || '0'}
          subtitle={`${data?.matriculas.total || 0} no total`}
          variant="violet"
        />

        {/* Financeiro */}
        <Card
          title="Cobranças Pendentes"
          icon={CreditCard}
          value={data?.financeiro.pendentes.toString() || '0'}
          subtitle={
            data?.financeiro.totalPendente
              ? `R$ ${Number(data.financeiro.totalPendente).toFixed(2)}`
              : 'Nenhuma pendência'
          }
          variant={data?.financeiro.pendentes ? 'red' : 'green'}
        />

        {/* Eventos */}
        <Card
          title="Próximos Eventos"
          icon={Calendar}
          value={data?.eventos.proximos.toString() || '0'}
          subtitle="eventos confirmados"
          variant="blue"
        />
      </div>

      {/* Próximo vencimento */}
      {data?.financeiro.proxVencimento && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-100 rounded-lg">
              <AlertCircle className="h-6 w-6 text-amber-700" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900">Próximo Vencimento</h3>
              <p className="mt-1 text-sm text-amber-800">
                Você tem uma cobrança de{' '}
                <span className="font-semibold">R$ {Number(data.financeiro.proxVencimento.valor).toFixed(2)}</span>{' '}
                com vencimento em{' '}
                <span className="font-semibold">
                  {new Date(data.financeiro.proxVencimento.data).toLocaleDateString('pt-BR')}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Ações rápidas */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Ações Rápidas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickAction
            title="Ver Matrículas"
            description="Consulte o status das suas matrículas"
            href="/portal/matriculas"
          />
          <QuickAction
            title="Financeiro"
            description="Veja e pague suas cobranças"
            href="/portal/financeiro"
          />
          <QuickAction
            title="Meus Eventos"
            description="Eventos inscritos e ingressos"
            href="/portal/eventos"
          />
          <QuickAction
            title="Meu Perfil"
            description="Atualize seus dados pessoais"
            href="/portal/perfil"
          />
        </div>
      </div>
    </div>
  );
}

type CardIcon = ComponentType<{ className?: string }>;

function Card({
  title,
  icon: Icon,
  value,
  subtitle,
  variant,
}: {
  title: string;
  icon: CardIcon;
  value: string;
  subtitle: string;
  variant: 'violet' | 'red' | 'green' | 'blue';
}) {
  const colors = {
    violet: 'from-violet-500 to-violet-600',
    red: 'from-red-500 to-red-600',
    green: 'from-green-500 to-green-600',
    blue: 'from-blue-500 to-blue-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className={`p-3 rounded-lg bg-gradient-to-br ${colors[variant]}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-start gap-4 p-4 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-all group"
    >
      <div className="flex-1">
        <h4 className="font-medium text-gray-900 group-hover:text-violet-700 transition-colors">
          {title}
        </h4>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>
      <svg
        className="h-5 w-5 text-gray-400 group-hover:text-violet-600 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </a>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

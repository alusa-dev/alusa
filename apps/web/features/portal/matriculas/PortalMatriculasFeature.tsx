'use client';

import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { User, Calendar, CreditCard, AlertCircle, CheckCircle, Clock } from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import type { PortalMatriculaDTO } from '@/features/portal/dtos';

export function PortalMatriculasFeature() {
  const { data: session } = useSession();
  const [matriculas, setMatriculas] = useState<PortalMatriculaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMatriculas() {
      try {
        setLoading(true);
        const response = await fetch('/api/portal/matriculas');
        if (!response.ok) {
          throw new Error('Erro ao carregar matrículas');
        }
        const result = await response.json();
        setMatriculas(result.matriculas || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    if (session?.user) {
      loadMatriculas();
    }
  }, [session]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
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

  const matriculasAtivas = matriculas.filter((m) => m.status === 'ATIVA');
  const matriculasInativas = matriculas.filter((m) => m.status !== 'ATIVA');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Minhas Matrículas</h1>
        <p className="mt-2 text-gray-600">Acompanhe suas matrículas e turmas</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard
          title="Total de Matrículas"
          value={matriculas.length.toString()}
          icon={User}
          variant="violet"
        />
        <SummaryCard
          title="Matrículas Ativas"
          value={matriculasAtivas.length.toString()}
          icon={CheckCircle}
          variant="green"
        />
        <SummaryCard
          title="Cobranças Pendentes"
          value={matriculas
            .reduce((sum, m) => sum + m.cobrancas.pendentes, 0)
            .toString()}
          icon={CreditCard}
          variant="amber"
        />
      </div>

      {/* Lista de Matrículas Ativas */}
      {matriculasAtivas.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Matrículas Ativas</h2>
          {matriculasAtivas.map((matricula) => (
            <MatriculaCard key={matricula.id} matricula={matricula} />
          ))}
        </div>
      )}

      {/* Lista de Matrículas Inativas */}
      {matriculasInativas.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Matrículas Anteriores</h2>
          {matriculasInativas.map((matricula) => (
            <MatriculaCard key={matricula.id} matricula={matricula} />
          ))}
        </div>
      )}

      {matriculas.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
          <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Nenhuma matrícula encontrada</h3>
          <p className="mt-2 text-gray-600">
            Você ainda não possui matrículas registradas no sistema.
          </p>
        </div>
      )}
    </div>
  );
}

type SummaryIcon = ComponentType<{ className?: string }>;

function SummaryCard({
  title,
  value,
  icon: Icon,
  variant,
}: {
  title: string;
  value: string;
  icon: SummaryIcon;
  variant: 'violet' | 'green' | 'amber';
}) {
  const colors = {
    violet: 'from-violet-500 to-violet-600',
    green: 'from-green-500 to-green-600',
    amber: 'from-amber-500 to-amber-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`p-3 rounded-lg bg-gradient-to-br ${colors[variant]}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function MatriculaCard({ matricula }: { matricula: PortalMatriculaDTO }) {
  const statusConfig = {
    ATIVA: { label: 'Ativa', variant: 'default' as const, color: 'bg-green-100 text-green-800' },
    CANCELADA: { label: 'Cancelada', variant: 'destructive' as const, color: 'bg-red-100 text-red-800' },
    SUSPENSA: { label: 'Suspensa', variant: 'secondary' as const, color: 'bg-gray-100 text-gray-800' },
    CONCLUIDA: { label: 'Concluída', variant: 'outline' as const, color: 'bg-blue-100 text-blue-800' },
  };

  const status = statusConfig[matricula.status as keyof typeof statusConfig] || statusConfig.ATIVA;
  const diasSemanaMap: Record<string, string> = {
    SEG: 'Seg',
    TER: 'Ter',
    QUA: 'Qua',
    QUI: 'Qui',
    SEX: 'Sex',
    SAB: 'Sáb',
    DOM: 'Dom',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white font-bold text-xl">
            {matricula.aluno.nome.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{matricula.aluno.nome}</h3>
            <p className="text-sm text-gray-600">
              {matricula.turma?.modalidade.nome ?? matricula.combo?.nome ?? '—'}
            </p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>
          {status.label}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        {/* Informações da Turma */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">Turma / Combo</p>
              {matricula.turma ? (
                <>
                  <p className="text-sm text-gray-600">{matricula.turma.nome}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {matricula.turma.diasSemana.map((d) => diasSemanaMap[d] || d).join(', ')} •{' '}
                    {matricula.turma.horaInicio} - {matricula.turma.horaFim}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-600">{matricula.combo?.nome ?? '—'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Informações Financeiras */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <CreditCard className="h-5 w-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">
                {matricula.plano ? 'Plano' : 'Combo'}
              </p>
              <p className="text-sm text-gray-600">
                {matricula.plano
                  ? `${matricula.plano.nome} • ${matricula.plano.periodicidade}`
                  : matricula.combo?.nome ?? '—'}
              </p>
              {matricula.plano && (
                <p className="text-sm font-semibold text-gray-900 mt-1">
                  R$ {Number(matricula.plano.valor).toFixed(2)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Alertas de Cobranças Pendentes */}
      {matricula.cobrancas.pendentes > 0 && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900">
                {matricula.cobrancas.pendentes} cobrança(s) pendente(s)
              </p>
              <p className="text-sm text-amber-800 mt-1">
                Total: R$ {Number(matricula.cobrancas.totalPendente).toFixed(2)}
              </p>
            </div>
            <a
              href="/portal/financeiro"
              className="text-sm font-medium text-amber-700 hover:text-amber-800 underline"
            >
              Ver cobranças
            </a>
          </div>
        </div>
      )}

      {/* Período */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="flex items-center gap-6 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              Início: {new Date(matricula.dataInicio).toLocaleDateString('pt-BR')}
            </span>
          </div>
          {matricula.dataFimContrato && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>
                Fim do contrato: {new Date(matricula.dataFimContrato).toLocaleDateString('pt-BR')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

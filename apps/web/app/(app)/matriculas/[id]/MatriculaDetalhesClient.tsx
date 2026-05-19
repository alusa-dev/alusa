'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft as ArrowLeft } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import { StatusCobranca, StatusMatricula } from '@prisma/client';
import { MatriculaHeader } from '@/components/rematriculas/MatriculaHeader';
import { DadosAluno } from '@/components/rematriculas/DadosAluno';
import { DadosMatricula } from '@/components/rematriculas/DadosMatricula';
import { DadosPlano } from '@/components/rematriculas/DadosPlano';
import { TaxaMatriculaSection } from '@/components/rematriculas/TaxaMatriculaSection';
import { ConfiguracoesPagamento } from '@/components/rematriculas/ConfiguracoesPagamento';
import { AcoesMatricula } from '@/components/rematriculas/AcoesMatricula';
import { cn } from '@/lib/utils';

/** Largura máxima alinhada ao cabeçalho (detalhe de matrícula). */
const DETAIL_SECTION_MAX = 'mx-auto w-full max-w-4xl';

type MatriculaDetalhes = {
  id: string;
  status: StatusMatricula;
  pausaAtiva?: boolean;
  dataInicioPausa?: string | null;
  dataRetornoPrevista?: string | null;
  manterVaga?: boolean;
  cobrarDurantePausa?: boolean;
  motivoPausa?: string | null;
  integrationStatus?: 'PENDENTE_SINCRONISMO' | 'SINCRONIZADO' | 'DIVERGENTE';
  warningCode?: string | null;
  dataInicio: string;
  dataFim?: string | null;
  vencimentoDia: number;
  taxaMatricula: number;
  taxaIsenta: boolean;
  asaasSubscriptionId?: string | null;
  jurosMensal?: number | null;
  jurosTipo?: 'FIXED' | 'PERCENTAGE' | null;
  multaPercentual?: number | null;
  multaTipo?: 'FIXED' | 'PERCENTAGE' | null;
  descontoAntecipado?: number | null;
  descontoTipo?: 'FIXED' | 'PERCENTAGE' | null;
  prazoDesconto?: number | null;
  assinaturaSnapshot?: {
    asaasSubscriptionId: string;
    status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
    billingType?: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED' | null;
    value?: number | null;
    nextDueDate?: string | null;
    deleted: boolean;
    syncError?: string | null;
    syncedAt?: string | null;
  } | null;
  aluno: {
    id: string;
    nome: string;
    cpf?: string | null;
    email?: string | null;
    telefone?: string | null;
  };
  turma?: {
    id: string;
    nome: string;
    horaInicio: string;
    horaFim: string;
    diasSemana: string[];
  } | null;
  combo?: {
    id: string;
    nome: string;
    valor?: number;
    periodicidade?: string;
  } | null;
  plano?: {
    id: string;
    nome: string;
    valor: number;
    periodicidade: string;
  } | null;
  responsavelFinanceiro?: {
    id: string;
    nome: string;
    cpf: string;
    email: string;
    telefone: string;
  } | null;
  cobrancas: Array<{
    id: string;
    tipo: string;
    status: StatusCobranca;
    valor: number;
    vencimento: string;
    dataPagamento?: string | null;
    formaPagamento: string;
    jurosPercentual?: number | null;
    multaPercentual?: number | null;
    descontoTipo?: string | null;
    descontoPercentual?: number | null;
    descontoValorFixo?: number | null;
    asaasPaymentId?: string | null;
    origin?: 'ACADEMIC' | 'STANDALONE';
  }>;
};

type MatriculaPausaResumo = {
  matriculaId: string;
  status: StatusMatricula;
  pausaAtiva: boolean;
  dataInicioPausa: string | null;
  dataRetornoPrevista: string | null;
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  motivoPausa: string | null;
  integrationStatus: 'PENDENTE_SINCRONISMO' | 'SINCRONIZADO' | 'DIVERGENTE';
  warningCode: string | null;
  asaasSubscriptionId: string | null;
  operacoes: Array<{
    id: string;
    tipo: string;
    status: string;
    createdAt: string;
    processedAt: string | null;
    observacao: string | null;
    cobrancasFuturasRemovidas: number;
    warnings: string[];
  }>;
};

export function MatriculaDetalhesClient({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [matricula, setMatricula] = useState<MatriculaDetalhes | null>(null);
  const [pausaResumo, setPausaResumo] = useState<MatriculaPausaResumo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMatricula = useCallback(async () => {
    console.log('🔵 [PAGE] loadMatricula chamado');
    setLoading(true);
    setError(null);

    try {
      console.log('🔵 [PAGE] Buscando matrícula:', id);
      const [matriculaResponse, pausaResumoResponse] = await Promise.allSettled([
        fetch(`/api/matriculas/${id}`, { cache: 'no-store' }),
        fetch(`/api/matriculas/${id}/pausa-resumo`, { cache: 'no-store' }),
      ]);

      if (matriculaResponse.status !== 'fulfilled') {
        throw matriculaResponse.reason;
      }

      const res = matriculaResponse.value;

      console.log('🔵 [PAGE] Resposta recebida:', { status: res.status, ok: res.ok });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Erro ao carregar matrícula');
      }

      const data = await res.json();
      console.log('🔵 [PAGE] Dados da matrícula recebidos:', {
        jurosMensal: data.matricula.jurosMensal,
        multaPercentual: data.matricula.multaPercentual,
      });
      setMatricula(data.matricula);

      if (pausaResumoResponse.status === 'fulfilled' && pausaResumoResponse.value.ok) {
        const pausaData = await pausaResumoResponse.value.json();
        setPausaResumo(pausaData);
      } else {
        setPausaResumo(null);
      }

      console.log('🟢 [PAGE] Matrícula atualizada no estado');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      pushToast({
        title: 'Erro',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadMatricula();
  }, [loadMatricula]);

  // Loading state
  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 py-6 px-4 pb-8">
          <div className={cn('mb-8 space-y-4', DETAIL_SECTION_MAX)}>
            <Skeleton className="h-10 w-32" />
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-3 h-9 w-full max-w-md" />
                <Skeleton className="h-5 w-80 max-w-full" />
              </div>
            </div>
          </div>

          <div className={cn('space-y-8', DETAIL_SECTION_MAX)}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 px-6 py-5">
                  <Skeleton className="mb-2 h-6 w-64" />
                  <Skeleton className="h-4 w-96 max-w-full" />
                </div>
                <div className="px-6 py-6">
                  <Skeleton className="h-64 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !matricula) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 py-6 px-4">
          <div className={DETAIL_SECTION_MAX}>
            <button
              onClick={() => router.back()}
              className="mb-8 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
                  <span className="text-4xl">⚠️</span>
                </div>
                <h2 className="mb-2 text-2xl font-bold text-gray-900">Erro ao carregar matrícula</h2>
                <p className="mb-8 max-w-md text-base text-gray-600">
                  {error || 'A matrícula solicitada não foi encontrada ou não está acessível no momento'}
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => router.back()}
                    className="h-10 border-gray-300 px-4 text-gray-700 hover:bg-gray-50"
                  >
                    Voltar
                  </Button>
                  <Button
                    onClick={loadMatricula}
                    className="h-10 bg-brand-accent px-4 text-white hover:bg-brand-accent/90"
                  >
                    Tentar novamente
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full min-w-0 py-6 px-4 pb-8">
        <div className={cn('mb-8', DETAIL_SECTION_MAX)}>
          <button
            onClick={() => router.back()}
            className="mb-5 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>

          <MatriculaHeader />
        </div>

        <div className={cn('space-y-8', DETAIL_SECTION_MAX)}>
          {/* Dados do Aluno */}
          <DadosAluno aluno={matricula.aluno} />

          {/* Dados da Matrícula */}
          <DadosMatricula
            matriculaId={matricula.id}
            matricula={matricula}
            pausaResumo={pausaResumo}
            cobrancas={matricula.cobrancas}
            onRefresh={loadMatricula}
          />

          {/* Dados do Plano */}
          <DadosPlano
            matriculaId={matricula.id}
            onRefresh={loadMatricula}
            asaasSubscriptionId={matricula.asaasSubscriptionId}
            plano={matricula.plano}
            turma={matricula.turma}
            combo={matricula.combo}
          />

          {/* Taxa de Matrícula */}
          <TaxaMatriculaSection
            matriculaId={matricula.id}
            taxaMatricula={matricula.taxaMatricula}
            taxaIsenta={matricula.taxaIsenta}
            cobrancas={matricula.cobrancas}
            onRefresh={loadMatricula}
          />

          {/* Configurações de Pagamento */}
          <ConfiguracoesPagamento
            matriculaId={matricula.id}
            asaasSubscriptionId={matricula.asaasSubscriptionId}
            assinaturaSnapshot={matricula.assinaturaSnapshot}
            jurosAtual={matricula.jurosMensal || undefined}
            jurosTipoAtual={matricula.jurosTipo || undefined}
            multaAtual={matricula.multaPercentual || undefined}
            multaTipoAtual={matricula.multaTipo || undefined}
            descontoAtual={matricula.descontoAntecipado || undefined}
            descontoTipoAtual={matricula.descontoTipo || undefined}
            prazoDescontoAtual={matricula.prazoDesconto || undefined}
            onRefresh={loadMatricula}
          />

          {/* Ações da Matrícula */}
          <AcoesMatricula
            matricula={matricula}
            onRefresh={loadMatricula}
            onNavigateToList={() => router.push('/matriculas')}
          />
        </div>
      </div>
    </div>
  );
}

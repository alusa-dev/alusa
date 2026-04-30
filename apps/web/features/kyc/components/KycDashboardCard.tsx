'use client';

import { useRouter } from 'next/navigation';
import { ChevronRight, Close } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { useKycEnforcement } from '../KycEnforcementProvider';

type KycDashboardCardProps = {
  onDismiss?: () => void;
};

export function KycDashboardCard({ onDismiss }: KycDashboardCardProps) {
  const router = useRouter();
  const { verification, loading, isApproved } = useKycEnforcement();

  if (loading || !verification || isApproved) return null;

  const isRejected = verification.status === 'ACCOUNT_REQUIRES_CORRECTION';
  const isUnderReview = verification.status === 'ACCOUNT_UNDER_REVIEW';

  const title = isRejected
    ? 'Corrija seu cadastro'
    : isUnderReview
      ? 'Cadastro em análise'
      : 'Conclua seu cadastro';

  const subtitle = isRejected
    ? 'Seus documentos foram reprovados. Reenvie as pendências para liberar as próximas etapas da conta.'
    : isUnderReview
      ? 'Recebemos seus documentos e estamos analisando. Você poderá continuar assim que a validação for concluída.'
      : 'Envie os documentos pendentes para liberar recursos\nfinanceiros e concluir a configuração inicial da conta.';

  return (
    <div
      className="relative flex h-full min-h-[220px] w-full flex-col justify-between rounded-2xl px-5 py-4"
      style={{ backgroundColor: '#e6d6fb', color: '#2b2634' }}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso de cadastro"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-[#2b2634]/70 transition hover:bg-[#2b2634]/5 hover:text-[#2b2634]"
        >
          <Close className="h-4 w-4" />
        </button>
      ) : null}

      <div className="flex h-full flex-col justify-between gap-5">
        <div className="min-w-0 max-w-2xl pr-10">
          <h3 className="text-[24px] font-semibold leading-tight" style={{ color: '#2b2634' }}>
            {title}
          </h3>
          <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-6" style={{ color: '#2b2634', opacity: 0.8 }}>
            {subtitle}
          </p>
        </div>

        {!isUnderReview && (
          <div className="pt-1">
            <Button
              size="sm"
              className="h-11 min-w-[220px] rounded-xl bg-[#5c2d91] px-5 text-sm font-medium text-white hover:bg-[#4b2377]"
              onClick={() => router.push('/conta/verificacao')}
            >
              Concluir cadastro
              <ChevronRight className="ml-2 h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

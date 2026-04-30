'use client';

import { Warning } from '@/components/icons/icons';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useKycEnforcement } from '../KycEnforcementProvider';

export function KycPendingBanner() {
  const router = useRouter();
  const { verification, loading, isApproved } = useKycEnforcement();

  if (loading || !verification || isApproved) return null;

  const isRejected = verification.status === 'ACCOUNT_REQUIRES_CORRECTION';
  const message = isRejected
    ? 'Sua verificação foi reprovada. Envie novamente os documentos pendentes para desbloquear o sistema.'
    : 'Seu cadastro ainda não foi concluído. Envie os documentos pendentes para liberar ações financeiras e acadêmicas.';

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-2">
        <Warning className="h-4 w-4 text-amber-600 mt-0.5" />
        <p className="text-sm text-amber-900">{message}</p>
      </div>
      <Button size="sm" onClick={() => router.push('/conta/verificacao')}>
        Enviar documentos pendentes
      </Button>
    </div>
  );
}

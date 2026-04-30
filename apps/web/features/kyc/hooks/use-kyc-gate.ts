'use client';

import { useCallback } from 'react';
import { useKycEnforcement } from '../KycEnforcementProvider';

type RequireKycOptions = {
  /** Mensagem contextual exibida no modal (ex.: "Para cadastrar alunos, finalize sua verificação.") */
  reason?: string;
  /** Callback executado somente se KYC aprovado */
  onAllowed: () => void;
};

type UseKycGateResult = {
  /** Verifica KYC antes de executar ação. Se não aprovado, abre modal de bloqueio. */
  requireKyc: (opts: RequireKycOptions) => void;
  /** true se o KYC está aprovado */
  isApproved: boolean;
  /** true enquanto o snapshot está carregando */
  loading: boolean;
};

export function useKycGate(): UseKycGateResult {
  const { isApproved, loading, isBlockingOpen, openBlocking } = useKycEnforcement();

  const requireKyc = useCallback(
    ({ reason, onAllowed }: RequireKycOptions) => {
      if (isApproved) {
        onAllowed();
        return;
      }
      // Evita abrir dois modais ao mesmo tempo
      if (!isBlockingOpen) {
        openBlocking(reason);
      }
    },
    [isApproved, isBlockingOpen, openBlocking],
  );

  return { requireKyc, isApproved, loading };
}

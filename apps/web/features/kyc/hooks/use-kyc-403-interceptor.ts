import { useCallback, useRef, useEffect } from 'react';
import { pushToast } from '@/components/ui/toast';
import { isPendingDocumentsBlockBypassedForTesting } from '../test-bypass';

/**
 * Hook que intercepta respostas 403 de APIs financeiras para exibir
 * um toast e redirecionar o usuário para /conta/verificacao.
 *
 * Uso: chamar `wrapFetch` envolvendo qualquer fetch financeiro, ou
 * montar no layout financeiro para interceptar globalmente.
 */
export function useKyc403Interceptor() {
  const redirectingRef = useRef(false);
  const bypassPendingDocumentsBlock = isPendingDocumentsBlockBypassedForTesting();

  useEffect(() => {
    return () => { redirectingRef.current = false; };
  }, []);

  const handle403 = useCallback(() => {
    if (bypassPendingDocumentsBlock) return;
    if (redirectingRef.current) return;
    redirectingRef.current = true;

    pushToast({
      title: 'Acesso bloqueado: pendências de documentação. Redirecionando...',
      variant: 'error',
    });

    setTimeout(() => {
      window.location.href = '/conta/verificacao';
    }, 1500);
  }, [bypassPendingDocumentsBlock]);

  const wrapFetch: typeof fetch = useCallback(
    async (input, init) => {
      const res = await fetch(input, init);
      if (bypassPendingDocumentsBlock) return res;
      if (res.status === 403) {
        const body = await res.clone().json().catch(() => null);
        if (body?.error === 'KYC_NAO_APROVADO' || body?.error === 'KYC_NOT_APPROVED') {
          handle403();
        }
      }
      return res;
    },
    [bypassPendingDocumentsBlock, handle403],
  );

  return { wrapFetch, handle403 };
}

import { useLiveRefresh, type LiveRefreshReason, type UseLiveRefreshOptions } from '@/hooks/useLiveRefresh';

type RefreshReason = LiveRefreshReason;
type UseFinanceLiveRefreshOptions = UseLiveRefreshOptions;

/**
 * Revalida leituras financeiras oficiais quando o usuário volta para a tela.
 * Mantém o Asaas como fonte de verdade, sem criar espelho local de saldo/ledger.
 */
export function useFinanceLiveRefresh(
  refresh: (_reason: RefreshReason) => void | Promise<void>,
  options: UseFinanceLiveRefreshOptions = {},
) {
  useLiveRefresh(refresh, options);
}

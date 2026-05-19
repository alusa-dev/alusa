import {
  useLiveRefresh,
  type LiveRefreshReason,
  type UseLiveRefreshOptions,
} from '@/hooks/useLiveRefresh';
import {
  useFinanceRealtimeSync,
  type FinanceRealtimeSyncScope,
} from '@/hooks/use-finance-realtime-sync';

export type UseFinanceLiveRefreshOptions = UseLiveRefreshOptions & {
  /** Webhook push via poll. `false` desliga; objeto customiza escopo. */
  realtime?: boolean | FinanceRealtimeSyncScope;
  /** Modo detalhe: filtra eventos por cobrança. */
  cobrancaId?: string;
};

/**
 * Revalida leituras financeiras (foco/intervalo) + sincronização rápida pós-webhook Asaas.
 */
export function useFinanceLiveRefresh(
  refresh: (_reason: LiveRefreshReason) => void | Promise<void>,
  options: UseFinanceLiveRefreshOptions = {},
) {
  const { realtime = true, cobrancaId, enabled, ...liveOptions } = options;
  const liveEnabled = enabled ?? true;

  useLiveRefresh(refresh, { ...liveOptions, enabled: liveEnabled });

  const realtimeScope: FinanceRealtimeSyncScope | false =
    realtime === false
      ? false
      : {
          dashboard: true,
          cobrancaQueries: !cobrancaId,
          financeiro: true,
          portal: true,
          ...(typeof realtime === 'object' ? realtime : {}),
        };

  const scopeForSync =
    realtimeScope === false
      ? false
      : {
          ...realtimeScope,
          onListRefresh:
            realtimeScope.onListRefresh ??
            (realtimeScope.localRefresh
              ? () => {
                  void refresh('interval');
                }
              : undefined),
        };

  useFinanceRealtimeSync({
    enabled: liveEnabled && scopeForSync !== false,
    cobrancaId,
    scope: scopeForSync === false ? undefined : scopeForSync,
  });
}

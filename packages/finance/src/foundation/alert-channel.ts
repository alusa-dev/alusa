/**
 * Alert Channel Service
 *
 * Abstração para envio de alertas operacionais para canais externos.
 * Canais suportados:
 *   - console (sempre ativo, fallback)
 *   - slack (via webhook URL)
 *   - email (via envio de notificação interna)
 *
 * Configuração via env:
 *   ALERT_SLACK_WEBHOOK_URL — URL do incoming webhook do Slack
 *   ALERT_EMAIL_ENABLED — "true" para ativar notificações por email
 *
 * Fail-safe: erros de envio nunca bloqueiam o fluxo principal.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AlertPayload {
  severity: AlertSeverity;
  title: string;
  message: string;
  contaId?: string;
  metadata?: Record<string, unknown>;
}

export interface AlertChannel {
  name: string;
  send(payload: AlertPayload): Promise<void>;
}

export interface AlertDispatchResult {
  channelResults: Array<{
    channel: string;
    success: boolean;
    error?: string;
  }>;
}

// ── Console Channel ──────────────────────────────────────────────────────

const consoleChannel: AlertChannel = {
  name: 'console',
  async send(payload) {
    const logData = {
      level: payload.severity,
      type: 'operational_alert',
      title: payload.title,
      message: payload.message,
      contaId: payload.contaId,
      metadata: payload.metadata,
      timestamp: new Date().toISOString(),
    };

    if (payload.severity === 'critical' || payload.severity === 'error') {
      console.error(JSON.stringify(logData));
    } else {
      console.warn(JSON.stringify(logData));
    }
  },
};

// ── Slack Channel ────────────────────────────────────────────────────────

function createSlackChannel(webhookUrl: string): AlertChannel {
  return {
    name: 'slack',
    async send(payload) {
      const emoji = {
        info: 'ℹ️',
        warning: '⚠️',
        error: '🔴',
        critical: '🚨',
      }[payload.severity];

      const text = [
        `${emoji} *${payload.title}*`,
        payload.message,
        payload.contaId ? `\`contaId: ${payload.contaId}\`` : '',
        payload.metadata ? `\`\`\`${JSON.stringify(payload.metadata, null, 2)}\`\`\`` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook returned ${response.status}`);
      }
    },
  };
}

// ── Alert Service ────────────────────────────────────────────────────────

class AlertService {
  private channels: AlertChannel[] = [consoleChannel];
  private initialized = false;

  /**
   * Inicializa canais baseado em variáveis de ambiente.
   * Chamado lazy no primeiro dispatch.
   */
  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const slackUrl = process.env.ALERT_SLACK_WEBHOOK_URL;
    if (slackUrl && slackUrl.startsWith('https://hooks.slack.com/')) {
      this.channels.push(createSlackChannel(slackUrl));
    }
  }

  /** Registra canal customizado (ex: para testes). */
  registerChannel(channel: AlertChannel): void {
    this.channels.push(channel);
  }

  /** Remove canais customizados (para testes). */
  resetChannels(): void {
    this.channels = [consoleChannel];
    this.initialized = false;
  }

  /**
   * Despacha alerta para todos os canais registrados.
   * Fail-safe: erros de canais individuais são capturados.
   */
  async dispatch(payload: AlertPayload): Promise<AlertDispatchResult> {
    this.initialize();

    const channelResults: AlertDispatchResult['channelResults'] = [];

    await Promise.allSettled(
      this.channels.map(async (channel) => {
        try {
          await channel.send(payload);
          channelResults.push({ channel: channel.name, success: true });
        } catch (err) {
          channelResults.push({
            channel: channel.name,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    return { channelResults };
  }

  // ── Convenience Methods ──────────────────────────────────────────────

  async alertDLQ(contaId: string, count: number, ids: string[]): Promise<void> {
    await this.dispatch({
      severity: 'error',
      title: 'Webhooks movidos para DLQ',
      message: `${count} webhook(s) exauriram tentativas e foram movidos para DLQ.`,
      contaId,
      metadata: { count, sampleIds: ids.slice(0, 5) },
    });
  }

  async alertInterruptedQueue(contaId: string, webhookIds: string[]): Promise<void> {
    await this.dispatch({
      severity: 'critical',
      title: 'Fila de webhook interrompida',
      message: `${webhookIds.length} webhook(s) interrompido(s) no Asaas. Eventos financeiros podem não estar chegando.`,
      contaId,
      metadata: { webhookIds },
    });
  }

  async alertCircuitOpen(contaId: string, failureCount: number): Promise<void> {
    await this.dispatch({
      severity: 'critical',
      title: 'Circuit breaker aberto',
      message: `Circuit breaker abriu após ${failureCount} falhas consecutivas. Chamadas ao Asaas bloqueadas temporariamente.`,
      contaId,
      metadata: { failureCount },
    });
  }

  async alertRateLimitExceeded(contaId: string, endpoint: string): Promise<void> {
    await this.dispatch({
      severity: 'warning',
      title: 'Rate limit Asaas atingido',
      message: `Rate limit excedido no endpoint ${endpoint}.`,
      contaId,
      metadata: { endpoint },
    });
  }

  async alertQuotaWarning(used: number, limit: number, percentUsed: number): Promise<void> {
    await this.dispatch({
      severity: 'warning',
      title: 'Quota de API próxima do limite',
      message: `${percentUsed.toFixed(1)}% da quota utilizada (${used}/${limit}).`,
      metadata: { used, limit, percentUsed },
    });
  }

  async alertReconciliationDrift(
    contaId: string,
    drift: { payments: number; subscriptions: number; installments: number },
  ): Promise<void> {
    const total = drift.payments + drift.subscriptions + drift.installments;
    if (total === 0) return;

    await this.dispatch({
      severity: 'warning',
      title: 'Drift detectado na reconciliação',
      message: `${total} divergência(s) encontrada(s) entre estado local e Asaas.`,
      contaId,
      metadata: drift,
    });
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const alertService = new AlertService();

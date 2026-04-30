/**
 * Handler para eventos INTERNAL_TRANSFER_* do Asaas.
 *
 * Esses eventos representam transferências internas entre contas Asaas
 * (crédito/débito entre subcontas ou entre conta master e subconta).
 *
 * No contexto da Alusa (ERP educacional com subcontas isoladas por instituição),
 * transferências internas não fazem parte do fluxo core de cobrança/matrícula.
 * Por isso, este handler:
 * - Registra o evento para fins de auditoria e observabilidade
 * - NÃO gera efeitos financeiros locais (não atualiza saldo, não cria entidades)
 *
 * Eventos tratados:
 * - INTERNAL_TRANSFER_CREDIT: subconta recebeu crédito de outra conta
 * - INTERNAL_TRANSFER_DEBIT: subconta teve débito para outra conta
 *
 * Se no futuro a Alusa implementar funcionalidade de repasse/split avançado,
 * este handler pode ser estendido para criar registros de conciliação.
 */

import { auditLogService } from '../foundation/audit-log.service';

export type InternalTransferWebhookPayload = {
  event: string;
  transfer: {
    id: string;
    value?: number;
    netValue?: number;
    description?: string;
    dateCreated?: string;
    status?: string;
  };
};

export async function handleInternalTransferWebhook(
  contaId: string,
  payload: InternalTransferWebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const { event, transfer } = payload;

    // Apenas registro para auditoria — sem efeitos financeiros locais.
    // Justificativa: transferências internas entre subcontas não afetam
    // o fluxo de matrícula → plano → cobrança → pagamento da Alusa.

    await auditLogService.record({
      contaId,
      action: 'finance.webhook.internal_transfer_received',
      entity: { type: 'InternalTransfer', id: transfer.id },
      metadata: {
        event,
        asaasTransferId: transfer.id,
        value: transfer.value ?? null,
        netValue: transfer.netValue ?? null,
        description: transfer.description ?? null,
        dateCreated: transfer.dateCreated ?? null,
        asaasStatus: transfer.status ?? null,
        note: 'Evento registrado para observabilidade. Sem efeito financeiro local.',
      },
      actor: { type: 'SYSTEM' },
    });

    console.log('📥 INTERNAL_TRANSFER registrado (observabilidade):', {
      event,
      asaasTransferId: transfer.id,
      value: transfer.value,
    });

    return { success: true };
  } catch (error) {
    console.error('[finance][handleInternalTransferWebhook]', error);
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}

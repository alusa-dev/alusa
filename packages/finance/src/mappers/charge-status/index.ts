/**
 * Charge Status Mapper - Fonte única de verdade para mapeamento de status
 *
 * Este módulo consolida TODOS os mapeamentos de status de cobrança do sistema:
 * 1. Asaas → StatusCobranca (tabela cobranca)
 * 2. Asaas → ChargeStatus (tabela charge)
 * 3. StatusCobranca → Badge UI
 * 4. ChargeStatus → Badge UI
 *
 * REGRA: Nunca criar statusMap inline em rotas ou componentes.
 * Usar sempre estas funções exportadas.
 */

export {
  mapAsaasPaymentStatusToCobranca,
  mapAsaasPaymentStatusToCharge,
  ASAAS_TO_COBRANCA_MAP,
  ASAAS_TO_CHARGE_MAP,
} from './asaas-to-internal';

export {
  getCobrancaStatusBadge,
  getChargeStatusBadge,
  getUnifiedBadgeStatus,
  getStatusLabel,
  getStatusBadgePresentation,
  type BadgeStatusType,
  type StatusBadgeConfig,
  type StatusBadgeUiVariant,
} from './status-badge-map';

export {
  isTerminalCobrancaStatus,
  isTerminalChargeStatus,
  TERMINAL_COBRANCA_STATUSES,
  TERMINAL_CHARGE_STATUSES,
} from './terminal-statuses';

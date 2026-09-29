import type { ChannelKey, NotificationEvent, NotificationPreference } from './types';

export interface ChannelConfig {
  key: ChannelKey;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface NotificationRowConfig {
  id: string;
  title: string;
  description: string;
  event: NotificationEvent;
  defaultSchedule: number;
  match: (pref: NotificationPreference) => boolean;
  scheduleEditable?: boolean;
  scheduleOptions?: number[];
  scheduleLabel?: string;
  providerChannels?: ChannelConfig[];
  customerChannels: ChannelConfig[];
}

export interface NotificationSectionConfig {
  id: string;
  title: string;
  description?: string;
  rows: NotificationRowConfig[];
}

const providerChannels: ChannelConfig[] = [
  { key: 'emailEnabledForProvider', label: 'Email' },
  { key: 'smsEnabledForProvider', label: 'SMS' },
];

const customerBaseChannels: ChannelConfig[] = [
  { key: 'emailEnabledForCustomer', label: 'Email' },
  { key: 'smsEnabledForCustomer', label: 'SMS' },
];

// Canais com WhatsApp (para eventos antes do vencimento e pagamento recebido)
const customerWithWhatsapp: ChannelConfig[] = [
  ...customerBaseChannels,
  { key: 'whatsappEnabledForCustomer', label: 'WhatsApp' },
];

// Canais completos com WhatsApp e Ligação (para eventos de atraso)
const customerFullChannels: ChannelConfig[] = [
  ...customerBaseChannels,
  { key: 'whatsappEnabledForCustomer', label: 'WhatsApp' },
  { key: 'phoneCallEnabledForCustomer', label: 'Ligação' },
];

const beforeDueRows: NotificationRowConfig[] = [
  {
    id: 'payment-created',
    title: 'Avisar criação de novas cobranças',
    description: 'Envia comunicação assim que uma nova cobrança é gerada. ⚠️ Não se aplica a cobranças criadas automaticamente por assinaturas.',
    event: 'PAYMENT_CREATED',
    defaultSchedule: 0,
    match: (pref) => pref.event === 'PAYMENT_CREATED',
    providerChannels,
    customerChannels: customerWithWhatsapp,
  },
  {
    id: 'payment-updated',
    title: 'Avisar alteração no valor ou data de vencimento das cobranças',
    description: 'Notifica o cliente quando a cobrança sofre alguma alteração crítica.',
    event: 'PAYMENT_UPDATED',
    defaultSchedule: 0,
    match: (pref) => pref.event === 'PAYMENT_UPDATED',
    providerChannels,
    customerChannels: customerWithWhatsapp,
  },
  {
    id: 'payment-warning-advance',
    title: 'Enviar cobranças antes do vencimento',
    description: 'Dispara lembretes automáticos alguns dias antes do vencimento.',
    event: 'PAYMENT_DUEDATE_WARNING',
    defaultSchedule: 10,
    match: (pref) => pref.event === 'PAYMENT_DUEDATE_WARNING' && pref.scheduleOffset > 0,
    scheduleEditable: true,
    scheduleOptions: [5, 10, 15, 30],
    scheduleLabel: 'dias antes do vencimento',
    providerChannels,
    customerChannels: customerWithWhatsapp,
  },
  {
    id: 'payment-warning-day',
    title: 'Enviar cobranças pendentes no dia do vencimento',
    description: 'Garante que o cliente receba o boleto exatamente no dia de vencimento.',
    event: 'PAYMENT_DUEDATE_WARNING',
    defaultSchedule: 0,
    match: (pref) => pref.event === 'PAYMENT_DUEDATE_WARNING' && pref.scheduleOffset === 0,
    providerChannels,
    customerChannels: customerWithWhatsapp,
  },
  {
    id: 'payment-digitable-line',
    title: 'Enviar linha digitável do boleto caso não tenha sido visualizado',
    description: 'Entrega a linha digitável completa para facilitar o pagamento manual.',
    event: 'SEND_LINHA_DIGITAVEL',
    defaultSchedule: 0,
    match: (pref) => pref.event === 'SEND_LINHA_DIGITAVEL',
    providerChannels,
    customerChannels: customerBaseChannels,
  },
];

const overdueRows: NotificationRowConfig[] = [
  {
    id: 'payment-overdue',
    title: 'Avisar sobre atrasos e falhas nos pagamentos',
    description: 'Dispara alerta assim que a cobrança entra em atraso.',
    event: 'PAYMENT_OVERDUE',
    defaultSchedule: 0,
    match: (pref) => pref.event === 'PAYMENT_OVERDUE' && pref.scheduleOffset === 0,
    providerChannels,
    customerChannels: customerFullChannels,
  },
  {
    id: 'payment-overdue-reminder',
    title: 'Relembrar cobranças vencidas periodicamente',
    description: 'Mantém o cliente informado enquanto a cobrança estiver em aberto.',
    event: 'PAYMENT_OVERDUE',
    defaultSchedule: 7,
    match: (pref) => pref.event === 'PAYMENT_OVERDUE' && pref.scheduleOffset > 0,
    scheduleEditable: true,
    scheduleOptions: [1, 3, 7, 15, 30],
    scheduleLabel: 'dias após o vencimento',
    providerChannels,
    customerChannels: customerFullChannels,
  },
];

const paidRows: NotificationRowConfig[] = [
  {
    id: 'payment-received',
    title: 'Avisar quando os pagamentos forem confirmados',
    description: 'Confirma ao cliente que o pagamento foi compensado.',
    event: 'PAYMENT_RECEIVED',
    defaultSchedule: 0,
    match: (pref) => pref.event === 'PAYMENT_RECEIVED',
    providerChannels,
    customerChannels: customerWithWhatsapp,
  },
];

export const NOTIFICATION_SECTIONS: NotificationSectionConfig[] = [
  {
    id: 'before-due',
    title: 'Notificações para cobranças antes do vencimento',
    description: 'Configure os lembretes automáticos que antecedem o vencimento.',
    rows: beforeDueRows,
  },
  {
    id: 'overdue',
    title: 'Notificações para cobranças vencidas',
    description: 'Automatize o acompanhamento de inadimplência com múltiplos canais.',
    rows: overdueRows,
  },
  {
    id: 'paid',
    title: 'Notificações para cobranças pagas',
    rows: paidRows,
  },
];

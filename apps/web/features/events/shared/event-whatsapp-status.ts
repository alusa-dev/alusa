import type { EventSoftBadgeTone } from './EventSoftBadge';

export type EventWhatsAppStatusIcon = 'clock' | 'spinner' | 'check' | 'double-check' | 'alert' | 'none';

export function getEventWhatsAppStatus(status?: string | null): {
  label: string;
  tone: EventSoftBadgeTone;
  icon: EventWhatsAppStatusIcon;
} {
  switch (status) {
    case 'PENDING':
    case 'QUEUED': return { label: 'Envio solicitado', tone: 'info', icon: 'clock' };
    case 'PROCESSING': return { label: 'Enviando', tone: 'warning', icon: 'spinner' };
    case 'SENT': return { label: 'Enviado', tone: 'success', icon: 'check' };
    case 'DELIVERED': return { label: 'Entregue', tone: 'success', icon: 'double-check' };
    case 'READ': return { label: 'Lida', tone: 'success', icon: 'double-check' };
    case 'FAILED':
    case 'DLQ': return { label: 'Falha no envio', tone: 'danger', icon: 'alert' };
    case 'SKIPPED': return { label: 'Não enviado', tone: 'neutral', icon: 'none' };
    default: return { label: 'Sem envio', tone: 'neutral', icon: 'none' };
  }
}

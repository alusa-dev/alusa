import * as React from 'react';
import { getStatusLabel } from '@alusa/finance/client';
import { cn } from '@/lib/cn';

export type BadgeVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'warning'
  | 'info'
  | 'success'
  | 'neutral';

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  default: 'alusa-badge alusa-badge-variant-default',
  destructive: 'alusa-badge alusa-badge-variant-destructive',
  outline: 'alusa-badge alusa-badge-variant-outline',
  warning: 'alusa-badge alusa-badge-variant-warning',
  info: 'alusa-badge alusa-badge-variant-info',
  success: 'alusa-badge alusa-badge-variant-success',
  neutral: 'alusa-badge alusa-badge-variant-neutral',
};

const statusConfig = {
  CONFIRMED: { text: 'Confirmado', className: 'alusa-badge alusa-badge-tone-success' },
  CONFIRMADO: { text: 'Confirmado', className: 'alusa-badge alusa-badge-tone-success' },
  RECEIVED: { text: 'Recebido', className: 'alusa-badge alusa-badge-tone-success' },
  RECEBIDO: { text: 'Recebido', className: 'alusa-badge alusa-badge-tone-success' },
  PAGO: { text: 'Pago', className: 'alusa-badge alusa-badge-tone-success' },
  PAID: { text: 'Paga', className: 'alusa-badge alusa-badge-tone-success' },
  PENDING: { text: 'Pendente', className: 'alusa-badge alusa-badge-tone-warning' },
  PENDENTE: { text: 'Pendente', className: 'alusa-badge alusa-badge-tone-warning' },
  A_VENCER: { text: 'A vencer', className: 'alusa-badge alusa-badge-tone-info' },
  OPEN: { text: 'Aberta', className: 'alusa-badge alusa-badge-tone-warning' },
  CREATED: { text: 'Criada', className: 'alusa-badge alusa-badge-tone-info' },
  OVERDUE: { text: 'Atrasado', className: 'alusa-badge alusa-badge-tone-danger' },
  ATRASADO: { text: 'Atrasado', className: 'alusa-badge alusa-badge-tone-danger' },
  CANCELAMENTO_PENDENTE: {
    text: 'Cancelamento pendente',
    className: 'alusa-badge alusa-badge-tone-warning',
  },
  ESTORNADO_PARCIAL: { text: 'Estorno parcial', className: 'alusa-badge alusa-badge-tone-neutral' },
  PENDING_SYNC: { text: 'Sincronizando', className: 'alusa-badge alusa-badge-tone-info' },
  FAILED: { text: 'Falha no Pagamento', className: 'alusa-badge alusa-badge-tone-danger' },
  REFUNDED: { text: 'Reembolsado', className: 'alusa-badge alusa-badge-tone-warning' },
  REFUND_REQUESTED: { text: 'Reembolso Solicitado', className: 'alusa-badge alusa-badge-tone-warning' },
  CANCELED: { text: 'Cancelado', className: 'alusa-badge alusa-badge-tone-neutral' },
  CANCELADO: { text: 'Cancelado', className: 'alusa-badge alusa-badge-tone-neutral' },
  EXPIRADO: { text: 'Expirado', className: 'alusa-badge alusa-badge-tone-neutral' },
  ASSINADO: { text: 'Assinado', className: 'alusa-badge alusa-badge-tone-success' },
  ISENTO: { text: 'Isento', className: 'alusa-badge alusa-badge-tone-neutral' },
  MANUAL: { text: 'Pago Manualmente', className: 'alusa-badge alusa-badge-tone-brand' },
  RECEIVED_IN_CASH: { text: 'Pago em Dinheiro', className: 'alusa-badge alusa-badge-tone-brand' },
  ESTORNADO: { text: 'Estornado', className: 'alusa-badge alusa-badge-tone-danger' },
  PROCESSANDO: { text: 'Processando', className: 'alusa-badge alusa-badge-tone-warning' },
  ATIVO: { text: 'Ativo', className: 'alusa-badge alusa-badge-tone-success' },
  ENCERRADO: { text: 'Encerrado', className: 'alusa-badge alusa-badge-tone-neutral' },
  INATIVO: { text: 'Inativo', className: 'alusa-badge alusa-badge-tone-danger' },
  ADMIN: { text: 'Admin', className: 'alusa-badge alusa-badge-tone-brand' },
  PROFESSOR: { text: 'Professor', className: 'alusa-badge alusa-badge-tone-info' },
  INSTRUTOR: { text: 'Instrutor', className: 'alusa-badge alusa-badge-tone-info' },
  SECRETARIA: { text: 'Secretaria', className: 'alusa-badge alusa-badge-tone-muted' },
  RECEPCIONISTA: { text: 'Recepcionista', className: 'alusa-badge alusa-badge-tone-muted' },
  GERENTE: { text: 'Gerente', className: 'alusa-badge alusa-badge-tone-info' },
  SEGUNDA: { text: 'Segunda', className: 'alusa-badge alusa-badge-tone-brand' },
  TERCA: { text: 'Terça', className: 'alusa-badge alusa-badge-tone-brand' },
  QUARTA: { text: 'Quarta', className: 'alusa-badge alusa-badge-tone-brand' },
  QUINTA: { text: 'Quinta', className: 'alusa-badge alusa-badge-tone-brand' },
  SEXTA: { text: 'Sexta', className: 'alusa-badge alusa-badge-tone-brand' },
  SABADO: { text: 'Sábado', className: 'alusa-badge alusa-badge-tone-brand' },
  DOMINGO: { text: 'Domingo', className: 'alusa-badge alusa-badge-tone-brand' },
  PENDENTE_TAXA: { text: 'Pendente Taxa', className: 'alusa-badge alusa-badge-tone-warning' },
  AGUARDANDO_CONFIRMACAO: { text: 'Aguardando Confirmação', className: 'alusa-badge alusa-badge-tone-info' },
  ATIVA: { text: 'Ativa', className: 'alusa-badge alusa-badge-tone-success' },
  INATIVA: { text: 'Inativa', className: 'alusa-badge alusa-badge-tone-danger' },
  PAUSADA: { text: 'Pausada', className: 'alusa-badge alusa-badge-tone-danger' },
  RECUSADA: { text: 'Recusada', className: 'alusa-badge alusa-badge-tone-danger' },
  CANCELADA: { text: 'Cancelada', className: 'alusa-badge alusa-badge-tone-neutral' },
  ADIMPLENTE: { text: 'Adimplente', className: 'alusa-badge alusa-badge-tone-success' },
  INADIMPLENTE: { text: 'Inadimplente', className: 'alusa-badge alusa-badge-tone-danger' },
  RECEPCAO: { text: 'Recepção', className: 'alusa-badge alusa-badge-tone-muted' },
  FINANCEIRO: { text: 'Financeiro', className: 'alusa-badge alusa-badge-tone-success' },
  RESPONSAVEL: { text: 'Responsável', className: 'alusa-badge alusa-badge-tone-info' },
  ALUNO: { text: 'Aluno', className: 'alusa-badge alusa-badge-tone-muted' },
  ADMINISTRATIVO: { text: 'Administrativo', className: 'alusa-badge alusa-badge-tone-muted' },
  OUTRO: { text: 'Outro', className: 'alusa-badge alusa-badge-tone-muted' },
  PENDING_INVITE: { text: 'Pendente', className: 'alusa-badge alusa-badge-tone-warning' },
  ACCEPTED: { text: 'Aceito', className: 'alusa-badge alusa-badge-tone-success' },
  REVOKED: { text: 'Revogado', className: 'alusa-badge alusa-badge-tone-danger' },
  EXPIRED: { text: 'Expirado', className: 'alusa-badge alusa-badge-tone-neutral' },
  DISPONIVEL: { text: 'Disponível', className: 'alusa-badge alusa-badge-tone-success' },
  INDISPONIVEL: { text: 'Indisponível', className: 'alusa-badge alusa-badge-tone-neutral' },
  EM_ANDAMENTO: { text: 'Em Andamento', className: 'alusa-badge alusa-badge-tone-info' },
  CONCLUIDO: { text: 'Concluído', className: 'alusa-badge alusa-badge-tone-success' },
  AGUARDANDO: { text: 'Aguardando', className: 'alusa-badge alusa-badge-tone-warning' },
} as const;

export type StatusType = keyof typeof statusConfig;

type BadgeSize = 'sm' | 'default' | 'lg';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  status?: StatusType;
  size?: BadgeSize;
  showIcon?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  status,
  size = 'default',
  showIcon: _showIcon,
  children,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap';
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    default: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1 text-sm',
  };

  if (status) {
    const config = statusConfig[status] ?? {
      text: getStatusLabel(status),
      className: 'alusa-badge alusa-badge-fallback',
    };
    return (
      <span
        className={cn(base, sizeClasses[size], config.className, className)}
        aria-label={config.text}
        {...props}
      >
        {config.text}
      </span>
    );
  }

  return (
    <span className={cn(base, sizeClasses[size], VARIANT_STYLES[variant], className)} {...props}>
      {children}
    </span>
  );
};

export function useStatusConfig(status: StatusType) {
  return statusConfig[status] ?? statusConfig.PENDING;
}

/** Rótulo legível para status (cobrança, pagamento, etc.). */
export function formatStatusLabel(status: string): string {
  return getStatusLabel(status);
}

export function isStatusPaid(status: StatusType): boolean {
  return ['CONFIRMED', 'RECEIVED', 'PAGO', 'MANUAL', 'RECEIVED_IN_CASH', 'CONCLUIDO'].includes(
    status,
  );
}

export function isStatusPending(status: StatusType): boolean {
  return ['PENDING', 'PENDENTE', 'AGUARDANDO', 'PROCESSANDO'].includes(status);
}

export function isStatusOverdue(status: StatusType): boolean {
  return ['OVERDUE', 'ATRASADO'].includes(status);
}

export function isStatusFailed(status: StatusType): boolean {
  return ['FAILED'].includes(status);
}

export function isStatusActive(status: StatusType): boolean {
  return ['ATIVO', 'DISPONIVEL', 'EM_ANDAMENTO'].includes(status);
}

export function isStatusInactive(status: StatusType): boolean {
  return ['INATIVO', 'INDISPONIVEL', 'CANCELADO', 'CANCELED'].includes(status);
}

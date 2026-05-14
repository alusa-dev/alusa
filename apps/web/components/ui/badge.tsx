import * as React from 'react';
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
  default: 'bg-[#E6D6FB] text-[#753CB8]',
  destructive: 'bg-[#FFD9B3] text-[#5C2A00]',
  outline: 'bg-white text-[#383242] border border-[#C9C5D1]',
  warning: 'bg-[#F3F9B3] text-[#5A630F]',
  info: 'bg-[#D9F2F5] text-[#1F4A52]',
  success: 'bg-[#CFF2DA] text-[#144E22]',
  neutral: 'bg-[#E6E4EA] text-[#383242]',
};

const statusConfig = {
  CONFIRMED: { text: 'confirmado', className: 'bg-[#CFF2DA] text-[#144E22]' },
  RECEIVED: { text: 'Pagamento Recebido', className: 'bg-[#CFF2DA] text-[#144E22]' },
  PAGO: { text: 'Pago', className: 'bg-[#CFF2DA] text-[#144E22]' },
  PENDING: { text: 'aguardando', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  PENDENTE: { text: 'Pendente', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  OVERDUE: { text: 'Atrasado', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  ATRASADO: { text: 'Atrasado', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  FAILED: { text: 'Falha no Pagamento', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  REFUNDED: { text: 'Reembolsado', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  REFUND_REQUESTED: { text: 'Reembolso Solicitado', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  CANCELED: { text: 'Cancelado', className: 'bg-[#E6E4EA] text-[#383242]' },
  CANCELADO: { text: 'Cancelado', className: 'bg-[#E6E4EA] text-[#383242]' },
  EXPIRADO: { text: 'Expirado', className: 'bg-[#E6E4EA] text-[#383242]' },
  ASSINADO: { text: 'Assinado', className: 'bg-[#CFF2DA] text-[#144E22]' },
  ISENTO: { text: 'Isento', className: 'bg-[#E6E4EA] text-[#383242]' },
  MANUAL: { text: 'Pago Manualmente', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  RECEIVED_IN_CASH: { text: 'Pago em Dinheiro', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  ESTORNADO: { text: 'Estornado', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  PROCESSANDO: { text: 'Processando', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  ATIVO: { text: 'Ativo', className: 'bg-[#CFF2DA] text-[#144E22]' },
  ENCERRADO: { text: 'Encerrado', className: 'bg-[#E6E4EA] text-[#383242]' },
  INATIVO: { text: 'Inativo', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  ADMIN: { text: 'Admin', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  PROFESSOR: { text: 'Professor', className: 'bg-[#D9F2F5] text-[#1F4A52]' },
  INSTRUTOR: { text: 'Instrutor', className: 'bg-[#D9F2F5] text-[#1F4A52]' },
  SECRETARIA: { text: 'Secretaria', className: 'bg-[#E6E4EA] text-[#383242]' },
  RECEPCIONISTA: { text: 'Recepcionista', className: 'bg-[#E6E4EA] text-[#383242]' },
  GERENTE: { text: 'Gerente', className: 'bg-[#D9F2F5] text-[#1F4A52]' },
  SEGUNDA: { text: 'Segunda', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  TERCA: { text: 'Terça', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  QUARTA: { text: 'Quarta', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  QUINTA: { text: 'Quinta', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  SEXTA: { text: 'Sexta', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  SABADO: { text: 'Sábado', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  DOMINGO: { text: 'Domingo', className: 'bg-[#E6D6FB] text-[#753CB8]' },
  PENDENTE_TAXA: { text: 'Pendente Taxa', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  AGUARDANDO_CONFIRMACAO: { text: 'Aguardando Confirmação', className: 'bg-[#D9F2F5] text-[#1F4A52]' },
  ATIVA: { text: 'Ativa', className: 'bg-[#CFF2DA] text-[#144E22]' },
  INATIVA: { text: 'Inativa', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  PAUSADA: { text: 'Pausada', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  RECUSADA: { text: 'Recusada', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  CANCELADA: { text: 'Cancelada', className: 'bg-[#E6E4EA] text-[#383242]' },
  ADIMPLENTE: { text: 'Adimplente', className: 'bg-[#CFF2DA] text-[#144E22]' },
  INADIMPLENTE: { text: 'Inadimplente', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  RECEPCAO: { text: 'Recepção', className: 'bg-[#E6E4EA] text-[#383242]' },
  FINANCEIRO: { text: 'Financeiro', className: 'bg-[#CFF2DA] text-[#144E22]' },
  RESPONSAVEL: { text: 'Responsável', className: 'bg-[#D9F2F5] text-[#1F4A52]' },
  ALUNO: { text: 'Aluno', className: 'bg-[#E6E4EA] text-[#383242]' },
  ADMINISTRATIVO: { text: 'Administrativo', className: 'bg-[#E6E4EA] text-[#383242]' },
  OUTRO: { text: 'Outro', className: 'bg-[#E6E4EA] text-[#383242]' },
  PENDING_INVITE: { text: 'Pendente', className: 'bg-[#F3F9B3] text-[#5A630F]' },
  ACCEPTED: { text: 'Aceito', className: 'bg-[#CFF2DA] text-[#144E22]' },
  REVOKED: { text: 'Revogado', className: 'bg-[#FFD9B3] text-[#5C2A00]' },
  EXPIRED: { text: 'Expirado', className: 'bg-[#E6E4EA] text-[#383242]' },
  DISPONIVEL: { text: 'Disponível', className: 'bg-[#CFF2DA] text-[#144E22]' },
  INDISPONIVEL: { text: 'Indisponível', className: 'bg-[#E6E4EA] text-[#383242]' },
  EM_ANDAMENTO: { text: 'Em Andamento', className: 'bg-[#D9F2F5] text-[#1F4A52]' },
  CONCLUIDO: { text: 'Concluído', className: 'bg-[#CFF2DA] text-[#144E22]' },
  AGUARDANDO: { text: 'Aguardando', className: 'bg-[#F3F9B3] text-[#5A630F]' },
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
    const config = statusConfig[status] ?? { text: status, className: 'bg-gray-100 text-gray-700' };
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

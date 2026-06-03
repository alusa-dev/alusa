'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Trash2,
  Ticket,
  Shirt,
  ClipboardList,
  WalletCards,
  CheckCircle2,
  XCircle,
  User,
  Clock,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Unlink,
} from 'lucide-react';

import {
  EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS,
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_FINANCIAL_STATUS_LABELS,
  EVENT_TICKET_SALE_STATUS_LABELS,
  type EventCostumeAssignmentStatus,
} from '@alusa/shared';

import { formatCurrency, formatDate, formatDateTime } from '@/features/events/events-service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import DataTable from '@/components/layout/DataTable';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { refundPublicEventMapOrder } from '@/features/events/events-service';
import { Receipt, RotateCcw, Trash } from '@/components/icons/icons';
import { exportPaidReceiptsPdf } from '@/features/financeiro/pagamentos/paid-receipts-pdf';
import { loadPaidReceiptSchoolProfile } from '@/features/financeiro/pagamentos/receipt-school-profile';
import { buildEventFeeReceiptInput } from './event-fee-receipt';

type EditSection = 'cadastro' | 'figurinos' | null;

const DETAIL_SECTION_MAX = 'mx-auto w-full max-w-4xl';
const sectionClass = cn(
  'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4',
  DETAIL_SECTION_MAX,
);
const labelClass = 'text-xs font-medium text-slate-600';
const editButtonClass = 'h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed disabled:opacity-100';
const disabledControlClass =
  'h-10 w-full rounded-lg border border-gray-200 bg-gray-100 px-3 text-sm text-gray-500 shadow-none disabled:opacity-100 disabled:cursor-not-allowed';

const participantTypeLabels: Record<string, string> = {
  STUDENT: 'Aluno',
  CLASS: 'Turma',
  GUARDIAN: 'Responsável',
  GUEST: 'Convidado',
  OTHER: 'Outro',
};

const EXTENDED_TICKET_SALE_STATUS_LABELS = {
  ...EVENT_TICKET_SALE_STATUS_LABELS,
  RESERVED: 'Reservado',
};

function SoftBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  const className = {
    neutral: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-rose-100 text-rose-800',
    info: 'bg-violet-100 text-violet-800',
  }[tone];
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>{children}</span>;
}

function TablePanel({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">{children}</div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center bg-white border border-dashed border-slate-200 rounded-lg">
      <span className="text-sm font-semibold text-slate-700">{title}</span>
      <span className="text-xs text-slate-500 mt-1">{description}</span>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-5 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar
    </button>
  );
}

function EditableSection({
  title,
  editSection,
  activeSection,
  saving,
  onEdit,
  onCancel,
  onSave,
  children,
  hideActions = false,
}: {
  title: string;
  editSection: Exclude<EditSection, null>;
  activeSection: EditSection;
  saving: boolean;
  onEdit: (_section: EditSection) => void;
  onCancel: () => void;
  onSave: () => void;
  children: React.ReactNode;
  hideActions?: boolean;
}) {
  const editing = activeSection === editSection;
  return (
    <section className={sectionClass}>
      <div className="mb-4 flex items-start justify-between">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        {!hideActions ? (
          editing ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={saving}
                className="border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={onSave}
                disabled={saving}
                className="bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(activeSection)}
              onClick={() => onEdit(editSection)}
              className={editButtonClass}
            >
              Editar
            </Button>
          )
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
  type = 'text',
  className,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange?: (_value: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className={labelClass}>{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={!editing}
        placeholder="Não informado"
        className={editing ? controlClass : disabledControlClass}
      />
    </div>
  );
}

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <Input value={value} disabled className={disabledControlClass} readOnly />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  editing,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  editing: boolean;
  onChange: (_value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className={labelClass}>{label}</label>
      {editing ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={controlClass}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          value={options.find((opt) => opt.value === value)?.label ?? value}
          disabled
          className={disabledControlClass}
          readOnly
        />
      )}
    </div>
  );
}

export function ParticipantDetailsFeature({
  eventId,
  participantId,
}: {
  eventId: string;
  participantId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [quitarConfirmOpen, setQuitarConfirmOpen] = useState<string | null>(null);
  const [quitarMethod, setQuitarMethod] = useState('MANUAL_PIX');
  const [refundOrderTarget, setRefundOrderTarget] = useState<{ orderId: string; buyerName: string } | null>(null);
  const [generatingReceiptId, setGeneratingReceiptId] = useState<string | null>(null);
  const [feeActionTarget, setFeeActionTarget] = useState<{ action: 'refund' | 'delete'; entryId: string } | null>(null);
  const [costumeEditTarget, setCostumeEditTarget] = useState<{ id: string; name: string } | null>(null);
  const [costumeActionTarget, setCostumeActionTarget] = useState<{ action: 'unlink' | 'refund'; id: string; name: string } | null>(null);

  // Form states
  const [generalForm, setGeneralForm] = useState({
    displayName: '',
    notes: '',
    isFeePaid: false,
  });

  const [costumeEditForm, setCostumeEditForm] = useState({ definedSize: '', status: 'PENDING', notes: '' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['events', 'participants', eventId, participantId],
    queryFn: async () => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? 'Não foi possível carregar os detalhes do inscrito.');
      }
      const json = await res.json();
      return json.data;
    },
  });

  const participant = data?.participant;
  const costumes = data?.costumes ?? [];
  const ticketSales = data?.ticketSales ?? [];
  const financialEntries = data?.financialEntries ?? [];
  const charges = data?.charges ?? [];

  const feeEntry = useMemo(() => {
    if (!participant?.revenueEntryId) return null;
    return financialEntries.find((e: any) => e.id === participant.revenueEntryId) ?? null;
  }, [participant, financialEntries]);
  const isManualPayment = !feeEntry?.asaasPaymentId;

  async function handleGenerateFeeReceipt(entry: any) {
    if (!participant) return;
    setGeneratingReceiptId(entry.id);
    try {
      const { aluno, item } = buildEventFeeReceiptInput(participant, entry);
      await exportPaidReceiptsPdf({
        aluno,
        items: [item],
        escola: await loadPaidReceiptSchoolProfile(),
      });
    } catch (err) {
      toast.error({
        title: 'Erro ao gerar recibo',
        description: err instanceof Error ? err.message : 'Não foi possível gerar o recibo da taxa.',
      });
    } finally {
      setGeneratingReceiptId(null);
    }
  }

  // Reset forms when data changes
  useEffect(() => {
    if (participant) {
      setGeneralForm({
        displayName: participant.displayName ?? '',
        notes: participant.notes ?? '',
        isFeePaid: participant.isFeePaid,
      });
    }
  }, [participant, costumes]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { displayName?: string; notes?: string | null; isFeePaid?: boolean; costumes?: any[] }) => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? 'Erro ao salvar alterações.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId, participantId] });
      toast.success({ title: 'Alterações salvas', description: 'Os dados da inscrição foram atualizados com sucesso.' });
      setEditSection(null);
    },
    onError: (err) => {
      toast.error({ title: 'Erro ao salvar', description: err.message });
    },
  });

  const refundPublicOrderMutation = useMutation({
    mutationFn: async (orderId: string) => refundPublicEventMapOrder(orderId),
    onSuccess: async () => {
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['events', 'sales', eventId] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
      ]);
      toast.success({ title: 'Estorno solicitado', description: 'O status será atualizado automaticamente via webhook do Asaas.' });
      setRefundOrderTarget(null);
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao estornar pagamento', description: (error as Error).message });
    },
  });

  const refundParticipantFeeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}/fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refund' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao estornar taxa.');
      }
      return res.json();
    },
    onSuccess: async () => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] });
      setFeeActionTarget(null);
      toast.success({ title: 'Taxa estornada', description: 'O recibo histórico foi preservado e a inscrição voltou a ficar sem pagamento ativo.' });
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao estornar taxa', description: (error as Error).message });
    },
  });

  const deleteParticipantFeeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}/fee`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao excluir cobrança.');
      }
      return res.json();
    },
    onSuccess: async () => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] });
      setFeeActionTarget(null);
      toast.success({ title: 'Cobrança excluída', description: 'A cobrança manual pendente foi removida da inscrição.' });
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao excluir cobrança', description: (error as Error).message });
    },
  });

  const updateCostumeAssignmentMutation = useMutation({
    mutationFn: async ({
      assignmentId,
      payload,
    }: {
      assignmentId: string;
      payload: { definedSize?: string | null; status?: string; notes?: string | null; alunoId?: string | null; turmaId?: string | null; isPaid?: boolean };
    }) => {
      const res = await fetch(`/api/events/costume-assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao atualizar figurino.');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] });
      if (variables.payload.status === 'CANCELLED' && variables.payload.alunoId === null) {
        toast.success({ title: 'Figurino desvinculado', description: 'O vínculo foi removido deste participante.' });
        setCostumeActionTarget(null);
      } else if (variables.payload.isPaid === false) {
        toast.success({ title: 'Pagamento estornado', description: 'O pagamento do figurino voltou para pendente antes da desvinculação.' });
        setCostumeActionTarget(null);
      } else {
        toast.success({ title: 'Figurino atualizado', description: 'As informações do vínculo foram salvas.' });
        setCostumeEditTarget(null);
      }
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao atualizar figurino', description: (error as Error).message });
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? 'Erro ao cancelar inscrição.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      toast.success({ title: 'Inscrição cancelada', description: 'O participante foi desinscrito com sucesso.' });
      router.push(`/events/${eventId}`);
    },
    onError: (err) => {
      toast.error({ title: 'Erro ao desinscrever', description: err.message });
    },
  });

  const quitarMutation = useMutation({
    mutationFn: async ({ method }: { method: string }) => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}/quitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: method }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? 'Erro ao registrar pagamento.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId, participantId] });
      toast.success({ title: 'Pagamento registrado', description: 'A taxa de inscrição foi quitada com sucesso.' });
      setQuitarConfirmOpen(null);
    },
    onError: (err) => {
      toast.error({ title: 'Erro ao quitar taxa', description: err.message });
    },
  });

  const cancelChargeMutation = useMutation({
    mutationFn: async (chargeId: string) => {
      const res = await fetch(`/api/cobrancas/${chargeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao cancelar cobrança.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId, participantId] });
      toast.success({ title: 'Cobrança cancelada', description: 'A cobrança foi cancelada com sucesso.' });
    },
    onError: (err) => {
      toast.error({ title: 'Erro ao cancelar cobrança', description: err.message });
    },
  });

  const confirmCashReceiveMutation = useMutation({
    mutationFn: async (chargeId: string) => {
      const res = await fetch(`/api/cobrancas/${chargeId}/confirmar-recebimento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formaPagamentoManual: 'DINHEIRO',
          observacao: 'Confirmação manual de recebimento via painel do evento',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao registrar recebimento.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId, participantId] });
      toast.success({ title: 'Recebimento registrado', description: 'A cobrança foi marcada como recebida em dinheiro.' });
    },
    onError: (err) => {
      toast.error({ title: 'Erro ao registrar recebimento', description: err.message });
    },
  });

  const refundChargeMutation = useMutation({
    mutationFn: async (chargeId: string) => {
      const res = await fetch(`/api/cobrancas/${chargeId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Estorno solicitado via painel do evento',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao realizar estorno.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId, participantId] });
      toast.success({ title: 'Estorno solicitado', description: 'O estorno da cobrança foi solicitado com sucesso.' });
    },
    onError: (err) => {
      toast.error({ title: 'Erro ao realizar estorno', description: err.message });
    },
  });

  const generatePaymentBookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/events/${eventId}/participants/${participantId}/payment-book`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? err?.message ?? 'Erro ao gerar carnê de parcelamento.');
      }
      return res.json();
    },
    onSuccess: (resData) => {
      const pdfUrl = resData?.data?.pdfUrl;
      if (pdfUrl) {
        window.open(pdfUrl, '_blank');
        toast.success({
          title: 'Carnê gerado',
          description: 'O carnê de parcelamento foi aberto em uma nova aba.',
        });
      } else {
        toast.error({
          title: 'Erro ao gerar carnê',
          description: 'A URL do PDF não foi retornada pelo gateway.',
        });
      }
    },
    onError: (err) => {
      toast.error({
        title: 'Erro ao gerar carnê',
        description: err.message,
      });
    },
  });

  const handleGeneralSave = () => {
    updateMutation.mutate({
      displayName: generalForm.displayName,
      notes: generalForm.notes,
      isFeePaid: generalForm.isFeePaid,
    });
  };

  const handleCancelEdit = () => {
    setEditSection(null);
    if (participant) {
      setGeneralForm({
        displayName: participant.displayName ?? '',
        notes: participant.notes ?? '',
        isFeePaid: participant.isFeePaid,
      });
    }
  };

  const avatarFallback = useMemo(() => {
    if (!participant?.displayName) return '?';
    return participant.displayName
      .split(' ')
      .slice(0, 2)
      .map((n: string) => n[0])
      .join('')
      .toUpperCase();
  }, [participant]);

  const renderTicketActions = (sale: any) => {
    const canRefund = sale.source === 'PUBLIC_ORDER' && sale.status === 'PAID' && sale.eventMapOrderId;
    const canViewTicket = sale.source === 'PUBLIC_ORDER' && sale.ticketsUrl;
    const canViewCharge = sale.source === 'PUBLIC_ORDER' && sale.status === 'RESERVED' && sale.invoiceUrl;

    if (!canRefund && !canViewTicket && !canViewCharge) {
      return <span className="text-slate-400">-</span>;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            disabled={refundPublicOrderMutation.isPending}
            aria-label="Ações do ingresso"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canViewCharge ? (
            <DropdownMenuItem asChild>
              <Link href={sale.invoiceUrl} target="_blank">Cobrança</Link>
            </DropdownMenuItem>
          ) : null}
          {canViewTicket ? (
            <DropdownMenuItem asChild>
              <Link href={sale.ticketsUrl} target="_blank">Ver ticket</Link>
            </DropdownMenuItem>
          ) : null}
          {canRefund ? (
            <>
              {(canViewCharge || canViewTicket) ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                className="text-rose-700 focus:text-rose-700"
                onClick={() => setRefundOrderTarget({ orderId: sale.eventMapOrderId, buyerName: sale.buyerName })}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Estornar pagamento
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const openCostumeEdit = (item: any) => {
    setCostumeEditTarget({ id: item.id, name: item.costume.name });
    setCostumeEditForm({
      definedSize: item.definedSize ?? '',
      status: item.status,
      notes: item.notes ?? '',
    });
  };

  const handleSaveCostumeEdit = () => {
    if (!costumeEditTarget) return;
    updateCostumeAssignmentMutation.mutate({
      assignmentId: costumeEditTarget.id,
      payload: {
        definedSize: costumeEditForm.definedSize || null,
        status: costumeEditForm.status,
        notes: costumeEditForm.notes || null,
      },
    });
  };

  const renderCostumeFinancialStatus = (item: any) => {
    if (item.billingMode === 'INCLUDED_IN_REGISTRATION_FEE') return <SoftBadge tone="info">Incluso</SoftBadge>;
    if (item.billingMode === 'FREE') return <SoftBadge tone="neutral">Sem cobrança</SoftBadge>;
    return item.isPaid ? <SoftBadge tone="success">Pago</SoftBadge> : <SoftBadge tone="warning">Pendente</SoftBadge>;
  };

  const formatCostumeChargedValue = (item: any) => {
    if (item.billingMode === 'FREE') return '-';
    if (item.billingMode === 'INCLUDED_IN_REGISTRATION_FEE') return 'Incluso';
    return formatCurrency(item.chargedValue);
  };

  const renderCostumeActions = (item: any) => {
    const isPaid = Boolean(item.isPaid);
    const hasSeparateCharge = item.billingMode === 'SEPARATE_CHARGE' && Boolean(item.revenueEntryId);
    const canRefund = isPaid && hasSeparateCharge;
    const canUnlink = !isPaid || !hasSeparateCharge;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Ações do figurino"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => openCostumeEdit(item)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </DropdownMenuItem>
          {canRefund ? (
            <DropdownMenuItem
              className="text-rose-700 focus:text-rose-700"
              onClick={() => setCostumeActionTarget({ action: 'refund', id: item.id, name: item.costume.name })}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Estornar pagamento
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canUnlink}
            onClick={() => setCostumeActionTarget({ action: 'unlink', id: item.id, name: item.costume.name })}
          >
            <Unlink className="mr-2 h-4 w-4" />
            Desvincular
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white">
        <div className="w-full min-w-0 px-4 py-6 pb-8">
          <div className={cn('mb-8 space-y-4', DETAIL_SECTION_MAX)}>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-16 w-96 max-w-full" />
          </div>
          <div className="space-y-8">
            {[1, 2, 3].map((item) => (
              <div key={item} className={sectionClass}>
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-40 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !participant) {
    return (
      <div className="bg-white">
        <div className="w-full min-w-0 px-4 py-6">
          <BackButton onClick={() => router.push(`/events/${eventId}`)} />
          <div className={cn('rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm', DETAIL_SECTION_MAX)}>
            <h2 className="text-2xl font-bold text-gray-900">Erro ao carregar inscrito</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
              {error instanceof Error ? error.message : 'A inscrição solicitada não foi encontrada.'}
            </p>
            <Button className="mt-6 bg-[#A94DFF] text-white hover:bg-[#A94DFF]/90 shadow-none" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white pb-12">
      <div className="w-full min-w-0 px-4 py-6">
        {/* Breadcrumb & Navigation */}
        <div className={cn(DETAIL_SECTION_MAX, 'mb-8')}>
          <BackButton onClick={() => router.push(`/events/${eventId}`)} />
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold leading-tight text-gray-900">
                Detalhes da Inscrição
              </h1>
              <p className="text-base text-gray-600 mt-1">
                Visualização de cadastro escolar, figurinos vinculados, bilheteria e recebimentos.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(true)}
              className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 shadow-none shrink-0 self-start md:self-center"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Cancelar Inscrição
            </Button>
          </div>
        </div>

        <div className="space-y-8">
          {/* Card Resumo / Avatar */}
          <div className={cn('rounded-xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col md:flex-row gap-6 md:items-center', DETAIL_SECTION_MAX)}>
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm flex items-center justify-center text-xl font-bold text-slate-500">
                {participant.aluno?.foto ? (
                  <img
                    src={participant.aluno.foto}
                    alt={participant.displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  avatarFallback
                )}
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-slate-900">{participant.displayName}</h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                  <p>
                    <span className="font-semibold text-slate-400">Tipo de Inscrição:</span>{' '}
                    <span className="font-medium text-slate-700">{participantTypeLabels[participant.type] || participant.type}</span>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-400">Turma:</span>{' '}
                    <span className="font-medium text-slate-700">{participant.turma?.nome || '—'}</span>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-400">Inscrito em:</span>{' '}
                    <span className="font-medium text-slate-700">{formatDate(participant.createdAt)}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Seção 1: Dados Gerais da Inscrição */}
          <EditableSection
            title="Dados Gerais da Inscrição"
            editSection="cadastro"
            activeSection={editSection}
            saving={updateMutation.isPending}
            onEdit={setEditSection}
            onCancel={handleCancelEdit}
            onSave={handleGeneralSave}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Nome do Participante"
                value={generalForm.displayName}
                editing={editSection === 'cadastro'}
                onChange={(val) => setGeneralForm((f) => ({ ...f, displayName: val }))}
              />
              <LockedField
                label="Tipo de Inscrição"
                value={participantTypeLabels[participant.type] || participant.type}
              />
              <LockedField
                label="Turma"
                value={participant.turma?.nome || '—'}
              />
              {editSection === 'cadastro' && participant.registrationFeeCharged > 0 && isManualPayment ? (
                <div className="space-y-1">
                  <label className={labelClass}>Status Financeiro da Inscrição</label>
                  <Select
                    value={generalForm.isFeePaid ? 'true' : 'false'}
                    onValueChange={(val) => setGeneralForm((f) => ({ ...f, isFeePaid: val === 'true' }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Pendente</SelectItem>
                      <SelectItem value="true">Pago</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <LockedField
                  label="Status Financeiro da Inscrição"
                  value={
                    participant.financialStatus === 'ISENTO' ? 'Isento' :
                    participant.financialStatus === 'QUITADO' ? 'Quitado' :
                    participant.financialStatus === 'EM_DIA' ? 'Em dia' :
                    participant.financialStatus === 'ATRASADO' ? 'Atrasado' :
                    participant.financialStatus === 'ESTORNADO' ? 'Estornado' :
                    participant.financialStatus === 'CANCELADO' ? 'Cancelado' :
                    participant.isFeePaid ? 'Pago' : 'Pendente'
                  }
                />
              )}
              <LockedField
                label="Valor da Taxa cobrado"
                value={formatCurrency(participant.registrationFeeCharged)}
              />
              <div className="md:col-span-2 space-y-1">
                <label className={labelClass}>Observações Internas (Inscrição)</label>
                {editSection === 'cadastro' ? (
                  <Textarea
                    value={generalForm.notes}
                    onChange={(e) => setGeneralForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Adicione notas sobre a inscrição ou detalhes de contato..."
                    className="min-h-20 border-slate-200 bg-white"
                  />
                ) : (
                  <Textarea
                    value={generalForm.notes || 'Sem observações registradas.'}
                    disabled
                    className="min-h-20 bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed shadow-none"
                  />
                )}
              </div>
            </div>
          </EditableSection>

          {/* Seção 2: Fluxo Financeiro da Inscrição */}
          <div className={cn('space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4', DETAIL_SECTION_MAX)}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Lançamentos Financeiros Vinculados</span>
            </div>

            <TablePanel>
              <DataTable
                columns={[
                  {
                    id: 'desc',
                    header: 'Tipo',
                    align: 'left',
                    width: 'w-[30%]',
                    render: (entry: any) => {
                      let displayDesc = entry.description;
                      if (displayDesc.startsWith('Taxa de inscrição - ')) {
                        displayDesc = 'Taxa de inscrição';
                      } else if (displayDesc.startsWith('Figurino - ')) {
                        displayDesc = displayDesc.replace('Figurino - ', '');
                      }
                      return (
                        <span className="font-semibold text-slate-900 text-xs sm:text-sm">{displayDesc}</span>
                      );
                    },
                  },
                  {
                    id: 'dueDate',
                    header: 'Vencimento',
                    align: 'left',
                    width: 'w-[14%]',
                    render: (entry: any) => formatDate(entry.dueDate),
                  },
                  {
                    id: 'realizedAt',
                    header: 'Pagamento',
                    align: 'left',
                    width: 'w-[14%]',
                    render: (entry: any) => formatDate(entry.realizedAt),
                  },
                  {
                    id: 'value',
                    header: 'Valor Pago',
                    align: 'right',
                    width: 'w-[14%]',
                    render: (entry: any) => {
                      const paidAmount = entry.actualAmount ?? 0;
                      return (
                        <span className="font-medium text-slate-900">
                          {formatCurrency(paidAmount)}
                        </span>
                      );
                    },
                  },
                  {
                    id: 'status',
                    header: 'Status',
                    align: 'center',
                    width: 'w-[14%]',
                    render: (entry: any) => {
                      if (participant && entry.id === participant.revenueEntryId) {
                        const status = participant.financialStatus || (participant.registrationFeeCharged === 0 ? 'ISENTO' : participant.isFeePaid ? 'QUITADO' : 'PENDENTE');
                        const statusTone = {
                          ISENTO: 'neutral',
                          QUITADO: 'success',
                          EM_DIA: 'info',
                          ATRASADO: 'danger',
                          PENDENTE: 'warning',
                          ESTORNADO: 'neutral',
                          CANCELADO: 'neutral',
                        }[status as string] || 'neutral';
                        const statusLabel = {
                          ISENTO: 'Isento',
                          QUITADO: 'Quitado',
                          EM_DIA: 'Em dia',
                          ATRASADO: 'Atrasado',
                          PENDENTE: 'Pendente',
                          ESTORNADO: 'Estornado',
                          CANCELADO: 'Cancelado',
                        }[status as string] || status;
                        return <SoftBadge tone={statusTone as any}>{statusLabel}</SoftBadge>;
                      }

                      const statusTone = {
                        PENDING: 'warning',
                        RECEIVED: 'success',
                        OVERDUE: 'danger',
                        REFUNDED: 'neutral',
                        CANCELLED: 'neutral',
                      }[entry.status as string] || 'neutral';
                      return <SoftBadge tone={statusTone as any}>{EVENT_FINANCIAL_STATUS_LABELS[entry.status as keyof typeof EVENT_FINANCIAL_STATUS_LABELS] || entry.status}</SoftBadge>;
                    },
                  },
                  {
                    id: 'actions',
                    header: 'Ações',
                    align: 'right',
                    width: 'w-[8%]',
                    render: (entry: any) => {
                      const isParticipantFee = participant && entry.id === participant.revenueEntryId;
                      const paidAmount = entry.actualAmount ?? 0;
                      const isAsaasEntry = Boolean(entry.asaasPaymentId || entry.paymentProvider === 'ASAAS');
                      const isPaidManualFee =
                        isParticipantFee &&
                        !entry.asaasPaymentId &&
                        participant.isFeePaid &&
                        paidAmount > 0 &&
                        entry.status !== 'REFUNDED' &&
                        entry.status !== 'CANCELLED';
                      const canGenerateReceipt = isPaidManualFee;
                      const canRefund = isPaidManualFee;
                      const canDelete =
                        isParticipantFee &&
                        !isAsaasEntry &&
                        !participant.isFeePaid &&
                        !entry.actualAmount &&
                        !['RECEIVED', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(entry.status);

                      if (!canGenerateReceipt && !canRefund && !canDelete) {
                        return <span className="text-slate-400">-</span>;
                      }

                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              disabled={generatingReceiptId === entry.id}
                              aria-label="Ações do lançamento"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {canGenerateReceipt ? (
                              <DropdownMenuItem onClick={() => void handleGenerateFeeReceipt(entry)}>
                                <Receipt className="mr-2 h-4 w-4" />
                                Emitir recibo
                              </DropdownMenuItem>
                            ) : null}
                            {canRefund ? (
                              <DropdownMenuItem onClick={() => setFeeActionTarget({ action: 'refund', entryId: entry.id })}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Estornar
                              </DropdownMenuItem>
                            ) : null}
                            {canDelete ? (
                              <>
                                {(canGenerateReceipt || canRefund) ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuItem
                                  className="text-rose-700 focus:text-rose-700"
                                  onClick={() => setFeeActionTarget({ action: 'delete', entryId: entry.id })}
                                >
                                  <Trash className="mr-2 h-4 w-4" />
                                  Excluir cobrança
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    },
                  },
                ]}
                data={financialEntries}
                rowKey={(entry) => entry.id}
                emptyMessage={<EmptyState title="Nenhum lançamento financeiro." description="Nenhuma taxa ou lançamento financeiro associado a este participante." />}
              />
            </TablePanel>
          </div>

          {/* Seção 2.5: Parcelas da Cobrança */}
          {charges.length > 0 && (
            <div className={cn('space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4', DETAIL_SECTION_MAX)}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Parcelas da cobrança</span>
                {data?.asaasInstallmentId && charges.some((c: any) => c.billingType === 'BOLETO' || c.billingType === 'PIX') && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={generatePaymentBookMutation.isPending}
                    onClick={() => generatePaymentBookMutation.mutate()}
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-none flex items-center gap-1.5"
                  >
                    {generatePaymentBookMutation.isPending ? 'Gerando...' : 'Gerar carnê de parcelamento'}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <TablePanel>
                <DataTable
                  columns={[
                    {
                      id: 'installment',
                      header: 'Parcela',
                      align: 'left',
                      width: 'w-[15%]',
                      render: (c: any) => {
                        const index = charges.findIndex((x: any) => x.id === c.id);
                        return (
                          <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                            {charges.length > 1 && index !== -1 ? `${index + 1}ª parcela` : 'Cobrança única'}
                          </span>
                        );
                      },
                    },
                    {
                      id: 'dueDate',
                      header: 'Vencimento',
                      align: 'left',
                      width: 'w-[20%]',
                      render: (c: any) => formatDate(c.dueDate),
                    },
                    {
                      id: 'value',
                      header: 'Valor',
                      align: 'right',
                      width: 'w-[15%]',
                      render: (c: any) => (
                        <span className="font-medium text-slate-900">{formatCurrency(c.value)}</span>
                      ),
                    },
                    {
                      id: 'billingType',
                      header: 'Método',
                      align: 'center',
                      width: 'w-[15%]',
                      render: (c: any) => {
                        const methodLabels: Record<string, string> = {
                          BOLETO: 'Boleto',
                          CREDIT_CARD: 'Cartão de Crédito',
                          PIX: 'Pix',
                        };
                        return (
                          <span className="text-slate-600 text-xs font-medium">
                            {methodLabels[c.billingType] || c.billingType || '-'}
                          </span>
                        );
                      },
                    },
                    {
                      id: 'status',
                      header: 'Status',
                      align: 'center',
                      width: 'w-[20%]',
                      render: (c: any) => {
                        const statusTone: Record<string, string> = {
                          CREATED: 'warning',
                          PENDING_SYNC: 'warning',
                          OPEN: 'warning',
                          PENDING: 'warning',
                          RECEIVED: 'success',
                          CONFIRMED: 'success',
                          RECEIVED_IN_CASH: 'success',
                          DUNNING_RECEIVED: 'success',
                          PAID: 'success',
                          OVERDUE: 'danger',
                          REFUNDED: 'neutral',
                          REFUND_IN_PROGRESS: 'neutral',
                          CHARGEBACK_REQUESTED: 'neutral',
                          CANCELED: 'neutral',
                        };
                        const statusLabels: Record<string, string> = {
                          CREATED: 'Pendente',
                          PENDING_SYNC: 'Pendente',
                          OPEN: 'Pendente',
                          PENDING: 'Pendente',
                          RECEIVED: 'Pago',
                          CONFIRMED: 'Confirmado',
                          RECEIVED_IN_CASH: 'Pago em Dinheiro',
                          DUNNING_RECEIVED: 'Pago',
                          PAID: 'Pago',
                          OVERDUE: 'Atrasado',
                          REFUNDED: 'Estornado',
                          REFUND_IN_PROGRESS: 'Estornando',
                          CHARGEBACK_REQUESTED: 'Chargeback',
                          CANCELED: 'Cancelado',
                        };
                        const tone = statusTone[c.status] || 'neutral';
                        const label = statusLabels[c.status] || c.status;
                        return <SoftBadge tone={tone as any}>{label}</SoftBadge>;
                      },
                    },
                    {
                      id: 'actions',
                      header: 'Ações',
                      align: 'right',
                      width: 'w-[15%]',
                      render: (c: any) => {
                        const isPaid = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAID'].includes(c.status);
                        const isUnpaid = ['CREATED', 'PENDING_SYNC', 'OPEN', 'PENDING', 'OVERDUE'].includes(c.status);
                        return (
                          <div onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                  <span className="sr-only">Abrir menu</span>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                {c.invoiceUrl && (
                                  <DropdownMenuItem onClick={() => window.open(c.invoiceUrl, '_blank')}>
                                    Ver cobrança
                                  </DropdownMenuItem>
                                )}
                                {isUnpaid && (
                                  <>
                                    <DropdownMenuItem onClick={() => confirmCashReceiveMutation.mutate(c.id)}>
                                      Recebimento em dinheiro
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => cancelChargeMutation.mutate(c.id)}
                                      className="text-red-600 focus:text-red-600"
                                    >
                                      Cancelar cobrança
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {isPaid && (
                                  <DropdownMenuItem
                                    onClick={() => refundChargeMutation.mutate(c.id)}
                                    className="text-red-600 focus:text-red-600"
                                  >
                                    Estornar
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      },
                    },
                  ]}
                  data={charges}
                  rowKey={(c) => c.id}
                  onRowClick={(c) => router.push(`/cobrancas/${c.id}`)}
                  emptyMessage={<EmptyState title="Nenhuma parcela encontrada." description="Nenhuma cobrança registrada no gateway para este plano." />}
                />
              </TablePanel>
            </div>
          )}

          {/* Seção 3: Figurinos Vinculados */}
          {participant.event.hasCostumes && (
            <section className={sectionClass}>
              <div className="mb-4 flex items-start justify-between">
                <span className="text-sm font-semibold text-slate-700">Figurinos Vinculados</span>
              </div>
              {costumes.length === 0 ? (
                <EmptyState title="Nenhum figurino vinculado." description="Atribua figurinos a este aluno através da aba de Figurinos na página do Evento." />
              ) : (
                <TablePanel>
                  <DataTable
                    columns={[
                      {
                        id: 'name',
                        header: 'Figurino',
                        align: 'left',
                        width: 'w-[25%]',
                        render: (item: any) => (
                          <span className="font-semibold text-slate-900 text-xs sm:text-sm">{item.costume.name}</span>
                        ),
                      },
                      {
                        id: 'size',
                        header: 'Tamanho',
                        align: 'left',
                        width: 'w-[15%]',
                        render: (item: any) => <span className="font-medium text-slate-800">{item.definedSize || '—'}</span>,
                      },
                      {
                        id: 'status',
                        header: 'Status Entrega',
                        align: 'left',
                        width: 'w-[20%]',
                        render: (item: any) => {
                          const tone = {
                            PENDING: 'warning',
                            ORDERED: 'info',
                            RECEIVED: 'info',
                            DELIVERED: 'success',
                            RETURNED: 'neutral',
                            CANCELLED: 'neutral',
                          }[item.status as string] || 'warning';
                          return <SoftBadge tone={tone as any}>{EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS[item.status as EventCostumeAssignmentStatus] || item.status}</SoftBadge>;
                        },
                      },
                      {
                        id: 'value',
                        header: 'Valor Cobrado',
                        align: 'right',
                        width: 'w-[15%]',
                        render: (item: any) => formatCostumeChargedValue(item),
                      },
                      {
                        id: 'finance',
                        header: 'Financeiro',
                        align: 'center',
                        width: 'w-[15%]',
                        render: (item: any) => renderCostumeFinancialStatus(item),
                      },
                      {
                        id: 'actions',
                        header: 'Ações',
                        align: 'right',
                        width: 'w-[10%]',
                        render: (item: any) => <span className="flex justify-end">{renderCostumeActions(item)}</span>,
                      },
                    ]}
                    data={costumes}
                    rowKey={(item) => item.id}
                  />
                </TablePanel>
              )}
            </section>
          )}

          {/* Seção 4: Ingressos Adquiridos */}
          {participant.event.hasTickets && (
            <div className={cn('space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4', DETAIL_SECTION_MAX)}>
              <span className="text-sm font-semibold text-slate-700">Ingressos Adquiridos</span>
              {ticketSales.length === 0 ? (
                <EmptyState title="Nenhum ingresso adquirido." description="Registre vendas de ingressos para este participante na aba Ingressos do Evento." />
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="grid grid-cols-[20fr_16fr_15fr_20fr_16fr_13fr] items-center bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <span className="px-6 py-3">Lote</span>
                    <span className="px-6 py-3">Venda</span>
                    <span className="px-6 py-3 text-right">Valor</span>
                    <span className="px-6 py-3 text-center">Método</span>
                    <span className="px-6 py-3 text-center">Status</span>
                    <span className="px-6 py-3 text-right">Ações</span>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {ticketSales.map((sale: any) => {
                      const paymentMethodLabel =
                        sale.paymentMethodLabel ||
                        EVENT_PAYMENT_METHOD_LABELS[sale.paymentMethod as keyof typeof EVENT_PAYMENT_METHOD_LABELS] ||
                        sale.paymentMethod ||
                        'Não informado';
                      const tone = {
                        RESERVED: 'info',
                        PENDING: 'warning',
                        PAID: 'success',
                        CANCELLED: 'danger',
                        REFUNDED: 'neutral',
                        COMPLIMENTARY: 'info',
                      }[sale.status as string] || 'neutral';

                      return (
                        <div
                          key={sale.id}
                          className="grid grid-cols-[20fr_16fr_15fr_20fr_16fr_13fr] items-center text-sm text-slate-700"
                        >
                          <span className="min-w-0 whitespace-normal break-words px-6 py-5 font-semibold text-slate-900" title={sale.lot.name}>
                            {sale.lot.name}
                          </span>
                          <span className="px-6 py-5 tabular-nums">{formatDate(sale.soldAt)}</span>
                          <span className="px-6 py-5 text-right font-medium tabular-nums text-slate-900">{formatCurrency(sale.totalAmount)}</span>
                          <span className="min-w-0 whitespace-normal break-words px-6 py-5 text-center text-xs font-medium text-slate-600" title={paymentMethodLabel}>{paymentMethodLabel}</span>
                          <span className="px-6 py-5 text-center">
                            <SoftBadge tone={tone as any}>{EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status as keyof typeof EXTENDED_TICKET_SALE_STATUS_LABELS] || sale.status}</SoftBadge>
                          </span>
                          <span className="flex justify-end px-6 py-5">{renderTicketActions(sale)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modals */}
      <ConfirmDeleteDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Cancelar Inscrição no Evento"
        description={`Tem certeza que deseja cancelar permanentemente a inscrição de ${participant.displayName}?\n\nEsta ação removerá o participante do evento e excluirá o lançamento financeiro associado à taxa de inscrição (caso ainda não esteja pago).`}
        onConfirm={async () => {
          await unregisterMutation.mutateAsync();
        }}
      />

      <Dialog open={quitarConfirmOpen !== null} onOpenChange={(o) => !o && setQuitarConfirmOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Quitar Taxa de Inscrição</DialogTitle>
            <DialogDescription>
              Confirmar o recebimento manual de {formatCurrency(participant.registrationFeeCharged)} para {participant.displayName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1">
              <label className={labelClass}>Forma de Pagamento</label>
              <select
                value={quitarMethod}
                onChange={(e) => setQuitarMethod(e.target.value)}
                className={controlClass}
              >
                <option value="MANUAL_PIX">Pix Manual</option>
                <option value="MANUAL_BOLETO">Boleto Pago Manualmente</option>
                <option value="MANUAL_CARD">Cartão Manual</option>
                <option value="MANUAL_CASH">Dinheiro / Caixa</option>
                <option value="MANUAL_TRANSFER">Transferência Bancária</option>
              </select>
            </div>
            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setQuitarConfirmOpen(null)}
              >
                Cancelar
              </Button>
              <Button
                disabled={quitarMutation.isPending}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white shadow-none"
                onClick={() => {
                  quitarMutation.mutate({ method: quitarMethod });
                }}
              >
                {quitarMutation.isPending ? 'Quitando...' : 'Quitar Taxa'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={feeActionTarget?.action === 'refund'}
        onOpenChange={(open) => {
          if (!open) setFeeActionTarget(null);
        }}
        title="Estornar taxa de inscrição?"
        description="O pagamento manual será marcado como estornado e o histórico financeiro será preservado para auditoria."
        confirmText="Estornar"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => refundParticipantFeeMutation.mutate()}
        loading={refundParticipantFeeMutation.isPending}
      />

      <ConfirmDialog
        open={feeActionTarget?.action === 'delete'}
        onOpenChange={(open) => {
          if (!open) setFeeActionTarget(null);
        }}
        title="Excluir cobrança?"
        description="Somente cobranças manuais pendentes podem ser excluídas. Taxas pagas ou estornadas permanecem no histórico."
        confirmText="Excluir cobrança"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => deleteParticipantFeeMutation.mutate()}
        loading={deleteParticipantFeeMutation.isPending}
      />

      <Dialog open={Boolean(costumeEditTarget)} onOpenChange={(open) => !open && setCostumeEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar figurino</DialogTitle>
            <DialogDescription>
              Atualize as informações do vínculo {costumeEditTarget ? `"${costumeEditTarget.name}"` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1">
              <label className={labelClass}>Tamanho</label>
              <Input
                value={costumeEditForm.definedSize}
                onChange={(event) => setCostumeEditForm((current) => ({ ...current, definedSize: event.target.value }))}
                placeholder="Informe o tamanho"
                className={controlClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Status de entrega</label>
              <select
                value={costumeEditForm.status}
                onChange={(event) => setCostumeEditForm((current) => ({ ...current, status: event.target.value }))}
                className={controlClass}
              >
                {Object.entries(EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Observações</label>
              <Textarea
                value={costumeEditForm.notes}
                onChange={(event) => setCostumeEditForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Observações internas"
                className="min-h-[88px] rounded-lg border-slate-200 text-sm shadow-sm focus:border-[#A94DFF] focus:ring-[#A94DFF]/30"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setCostumeEditTarget(null)}
              disabled={updateCostumeAssignmentMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              className="w-full bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90 sm:w-auto"
              onClick={handleSaveCostumeEdit}
              disabled={updateCostumeAssignmentMutation.isPending}
            >
              {updateCostumeAssignmentMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={costumeActionTarget?.action === 'unlink'}
        onOpenChange={(open) => {
          if (!open) setCostumeActionTarget(null);
        }}
        title="Desvincular figurino?"
        description={costumeActionTarget ? `O figurino "${costumeActionTarget.name}" será cancelado e deixará de aparecer para este participante.` : 'O figurino será desvinculado deste participante.'}
        confirmText="Desvincular"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (!costumeActionTarget) return;
          updateCostumeAssignmentMutation.mutate({
            assignmentId: costumeActionTarget.id,
            payload: {
              status: 'CANCELLED',
              alunoId: null,
              turmaId: null,
            },
          });
        }}
        loading={updateCostumeAssignmentMutation.isPending}
      />

      <ConfirmDialog
        open={costumeActionTarget?.action === 'refund'}
        onOpenChange={(open) => {
          if (!open) setCostumeActionTarget(null);
        }}
        title="Estornar pagamento do figurino?"
        description={costumeActionTarget ? `O pagamento próprio do figurino "${costumeActionTarget.name}" voltará para pendente. Depois disso, o figurino poderá ser desvinculado.` : 'O pagamento próprio do figurino voltará para pendente.'}
        confirmText="Estornar pagamento"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (!costumeActionTarget) return;
          updateCostumeAssignmentMutation.mutate({
            assignmentId: costumeActionTarget.id,
            payload: {
              isPaid: false,
            },
          });
        }}
        loading={updateCostumeAssignmentMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(refundOrderTarget)}
        onOpenChange={(open) => {
          if (!open) setRefundOrderTarget(null);
        }}
        title="Estornar pagamento?"
        description={refundOrderTarget ? `O estorno de ${refundOrderTarget.buyerName} será solicitado no Asaas e o status final será confirmado via webhook.` : 'O estorno será solicitado no Asaas e o status final será confirmado via webhook.'}
        confirmText="Solicitar estorno"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (!refundOrderTarget) return;
          refundPublicOrderMutation.mutate(refundOrderTarget.orderId);
        }}
        loading={refundPublicOrderMutation.isPending}
      />
    </div>
  );
}

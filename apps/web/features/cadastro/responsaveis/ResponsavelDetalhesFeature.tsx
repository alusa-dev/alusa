'use client';

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type StatusType } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Trash,
  Users,
} from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import { CustomerNotificationsEditor } from '@/features/cadastro/shared/CustomerNotificationsEditor';
import { formatInitials, maskCpf } from '@alusa/lib/client';
import { cn } from '@/lib/utils';

import {
  deleteResponsavel,
  getResponsavel,
  updateResponsavel,
  type ResponsavelDetail,
  type ResponsavelOverview,
} from './services/responsaveis-service';

type AlunoVinculado = {
  id: string;
  nome: string;
  dataNasc: string | null;
  cpf: string | null;
  foto: string | null;
  ativo: boolean;
};

type EditFormState = {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  enderecoCep: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoCidade: string;
  enderecoUf: string;
};

type EditSection = 'responsavel' | 'complementares' | null;
type ResponsavelCharge = ResponsavelOverview['charges'][number];
type ResponsavelSubscription = ResponsavelOverview['subscriptions'][number];
type ResponsavelInstallmentPlan = ResponsavelOverview['installmentPlans'][number];

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('pt-BR');
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return currencyFormatter.format(value);
}

/** Largura máxima das seções em detalhe (formulários, painéis, listas) — alinhada ao cabeçalho da página. */
const DETAIL_SECTION_MAX = 'mx-auto w-full max-w-4xl';

const sectionClass = cn(
  'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-5 sm:py-4',
  DETAIL_SECTION_MAX,
);
const labelClass = 'text-xs font-medium text-slate-600';
const editButtonClass = 'h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed disabled:opacity-100';
const disabledControlClass =
  'h-10 w-full rounded-lg border border-gray-200 bg-gray-100 px-3 text-sm text-gray-500 shadow-none disabled:opacity-100 disabled:cursor-not-allowed';

function buildFormState(detail: ResponsavelDetail): EditFormState {
  return {
    nome: detail.nome,
    cpf: detail.cpf,
    email: detail.email,
    telefone: detail.telefone,
    enderecoCep: detail.endereco.cep ?? '',
    enderecoLogradouro: detail.endereco.logradouro ?? '',
    enderecoNumero: detail.endereco.numero ?? '',
    enderecoComplemento: detail.endereco.complemento ?? '',
    enderecoBairro: detail.endereco.bairro ?? '',
    enderecoCidade: detail.endereco.cidade ?? '',
    enderecoUf: detail.endereco.uf ?? '',
  };
}

export function ResponsavelDetalhesFeature({ responsavelId }: { responsavelId: string }) {
  const router = useRouter();
  const [responsavel, setResponsavel] = useState<ResponsavelDetail | null>(null);
  const [alunos, setAlunos] = useState<AlunoVinculado[]>([]);
  const [overview, setOverview] = useState<ResponsavelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [openPanels, setOpenPanels] = useState({
    assinaturas: false,
    parcelamentos: false,
    cobrancas: true,
  });

  const load = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    setAlunos([]);
    setOverview(null);

    try {
      const detail = await getResponsavel({ id: responsavelId, signal: controller.signal });
      setResponsavel(detail);
      setForm(buildFormState(detail));

      const [alunosRes, overviewRes] = await Promise.all([
        fetch(`/api/responsaveis/${responsavelId}/alunos`, {
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(`/api/responsaveis/${responsavelId}/overview`, {
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]);

      if (alunosRes.ok) {
        const json = await alunosRes.json().catch(() => ({ items: [] }));
        setAlunos(Array.isArray(json.items) ? json.items : []);
      }

      if (overviewRes.ok) {
        const json = await overviewRes.json().catch(() => null);
        setOverview(json as ResponsavelOverview);
      }
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') {
        pushToast({
          title: 'Não foi possível carregar o responsável',
          description: (error as Error).message,
          variant: 'error',
        });
      }
    } finally {
      setLoading(false);
    }

    return () => controller.abort();
  }, [responsavelId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField<K extends keyof EditFormState>(field: K, value: EditFormState[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function resetForm() {
    if (responsavel) setForm(buildFormState(responsavel));
    setEditSection(null);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      const updated = await updateResponsavel(responsavelId, {
        nome: form.nome,
        cpf: form.cpf,
        email: form.email,
        telefone: form.telefone,
        endereco: {
          cep: form.enderecoCep,
          logradouro: form.enderecoLogradouro,
          numero: form.enderecoNumero,
          complemento: form.enderecoComplemento,
          bairro: form.enderecoBairro,
          cidade: form.enderecoCidade,
          uf: form.enderecoUf,
        },
      });
      setResponsavel(updated);
      setForm(buildFormState(updated));
      setEditSection(null);
      pushToast({
        title: 'Responsável atualizado',
        variant: 'success',
      });
    } catch (error) {
      pushToast({
        title: 'Não foi possível atualizar',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteResponsavel() {
    setDeleting(true);
    try {
      await deleteResponsavel(responsavelId);
      pushToast({
        title: 'Responsável excluído',
        variant: 'success',
      });
      setDeleteOpen(false);
      router.push('/responsaveis');
    } catch (error) {
      pushToast({
        title: 'Não foi possível excluir',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  }

  const recentCharges = useMemo(() => overview?.charges.slice(0, 4) ?? [], [overview]);
  const subscriptions = overview?.subscriptions ?? [];
  const installmentPlans = overview?.installmentPlans ?? [];

  if (loading) {
    return <ResponsavelDetalhesSkeleton />;
  }

  if (!responsavel) {
    return (
      <div className="h-full min-w-0 overflow-y-auto">
        <div className="w-full min-w-0 space-y-4 px-4 py-6">
          <Button
            variant="ghost"
            className="h-9 px-2 text-slate-600"
            onClick={() => router.push('/responsaveis')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">
            Responsável não encontrado.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="w-full min-w-0 px-4 py-6 pb-8">
        <div className={cn(DETAIL_SECTION_MAX, 'mb-8')}>
          <BackButton onClick={() => router.push('/responsaveis')} />

          <div>
            <h1 className="mb-2 text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">
              Detalhes do responsável
            </h1>
            <p className="text-sm text-gray-600 sm:text-base">
              Gerencie cadastro e alunos vinculados a este responsável.
            </p>
          </div>
        </div>

        <div className="space-y-6 sm:space-y-8">
          {form ? (
            <>
              <EditableSection
                title="Dados do Responsável"
                editSection="responsavel"
                activeSection={editSection}
                saving={saving}
                onEdit={setEditSection}
                onCancel={resetForm}
                onSave={handleSave}
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Nome Completo" value={form.nome} editing={editSection === 'responsavel'} onChange={(value) => updateField('nome', value)} />
                  <Field label="CPF" value={form.cpf} editing={editSection === 'responsavel'} onChange={(value) => updateField('cpf', value)} />
                  <Field label="E-mail" type="email" value={form.email} editing={editSection === 'responsavel'} onChange={(value) => updateField('email', value)} />
                  <Field label="Telefone" value={form.telefone} editing={editSection === 'responsavel'} onChange={(value) => updateField('telefone', value)} />
                  <LockedField label="Customer Asaas" value={responsavel.asaasCustomerId || 'Não sincronizado'} />
                </div>
              </EditableSection>

              <EditableSection
                title="Informações complementares"
                editSection="complementares"
                activeSection={editSection}
                saving={saving}
                onEdit={setEditSection}
                onCancel={resetForm}
                onSave={handleSave}
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <Field label="CEP" value={form.enderecoCep} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoCep', value)} />
                  <Field label="Rua" value={form.enderecoLogradouro} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoLogradouro', value)} className="md:col-span-2" />
                  <Field label="Número" value={form.enderecoNumero} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoNumero', value)} />
                  <Field label="Complemento" value={form.enderecoComplemento} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoComplemento', value)} />
                  <Field label="Bairro" value={form.enderecoBairro} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoBairro', value)} />
                  <Field label="Cidade" value={form.enderecoCidade} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoCidade', value)} />
                  <Field label="UF" value={form.enderecoUf} editing={editSection === 'complementares'} onChange={(value) => updateField('enderecoUf', value)} />
                  <LockedField label="Atualizado em" value={formatDate(responsavel.updatedAt)} />
                </div>
              </EditableSection>
            </>
          ) : null}

          <div className={DETAIL_SECTION_MAX}>
            <CustomerNotificationsEditor
              customerId={responsavel.asaasCustomerId}
              endpoint={`/api/responsaveis/${responsavel.id}/notificacoes`}
              description="Configuração do customer do responsável no Asaas. Essas preferências são usadas pelas cobranças dos alunos vinculados quando este responsável é o pagador."
              emptyMessage="Este responsável ainda não possui customer Asaas sincronizado para configurar notificações."
            />
          </div>

          <div className={DETAIL_SECTION_MAX}>
            <FinancialAccordion
              title="Assinaturas"
              open={openPanels.assinaturas}
              onToggle={() => setOpenPanels((current) => ({ ...current, assinaturas: !current.assinaturas }))}
              count={subscriptions.length}
              viewAllHref="/cobrancas/assinaturas"
              viewAllLabel="Visualizar todas as assinaturas"
            >
              <AssinaturasTable assinaturas={subscriptions.slice(0, 4)} />
            </FinancialAccordion>
          </div>

          <div className={DETAIL_SECTION_MAX}>
            <FinancialAccordion
              title="Parcelamentos"
              open={openPanels.parcelamentos}
              onToggle={() => setOpenPanels((current) => ({ ...current, parcelamentos: !current.parcelamentos }))}
              count={installmentPlans.length}
              viewAllHref="/cobrancas/parcelamentos"
              viewAllLabel="Visualizar todos os parcelamentos"
            >
              <ParcelamentosTable parcelamentos={installmentPlans.slice(0, 4)} />
            </FinancialAccordion>
          </div>

          <div className={DETAIL_SECTION_MAX}>
            <FinancialAccordion
              title="Cobranças"
              open={openPanels.cobrancas}
              onToggle={() => setOpenPanels((current) => ({ ...current, cobrancas: !current.cobrancas }))}
              count={overview?.charges.length ?? 0}
              viewAllHref="/cobrancas"
              viewAllLabel="Visualizar todas as cobranças"
            >
              <CobrancasTable cobrancas={recentCharges} />
            </FinancialAccordion>
          </div>

          <section className={sectionClass}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-700">Alunos vinculados</h2>
              <p className="mt-1 text-xs text-slate-500">
                Alunos cadastrados no fluxo de aluno ou vinculados diretamente a este responsável.
              </p>
            </div>

            {alunos.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {alunos.map((aluno) => (
                  <Link
                    key={aluno.id}
                    href={`/alunos/${aluno.id}`}
                    className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-slate-50 sm:px-2"
                  >
                    <Avatar className="h-10 w-10">
                      {aluno.foto ? <AvatarImage src={aluno.foto} alt={aluno.nome} /> : null}
                      <AvatarFallback className="bg-slate-100 text-slate-700">
                        {formatInitials(aluno.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{aluno.nome}</div>
                      <div className="text-xs text-slate-500">
                        {aluno.cpf ? maskCpf(aluno.cpf) : 'CPF não informado'}
                      </div>
                    </div>
                    <Badge status={aluno.ativo ? 'ATIVO' : 'INATIVO'} size="sm" className="shrink-0" />
                    <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <Users className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">Nenhum aluno vinculado</p>
                <p className="mt-1 text-xs text-slate-500">
                  Responsáveis criados aqui aparecerão disponíveis no fluxo de cadastro de aluno.
                </p>
              </div>
            )}
          </section>

          <div className={cn('border-t border-gray-200 pt-6', DETAIL_SECTION_MAX)}>
            <Button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="h-10 w-full rounded-md bg-red-600 px-4 text-sm font-medium text-white shadow-none hover:bg-red-700 md:w-auto"
              title="Excluir este cadastro de responsável"
            >
              <Trash className="mr-2 h-4 w-4" />
              Excluir Responsável
            </Button>
          </div>
        </div>

      <ExcluirResponsavelDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        nome={responsavel.nome}
        deleting={deleting}
        onConfirm={() => void handleDeleteResponsavel()}
      />

      </div>
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
  children: ReactNode;
  hideActions?: boolean;
}) {
  const editing = activeSection === editSection;
  return (
    <section className={sectionClass}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        {!hideActions ? (
          editing ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={saving}
                className="min-h-10 flex-1 border-slate-200 bg-white text-slate-600 hover:bg-slate-100 sm:flex-initial"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={onSave}
                disabled={saving}
                className="min-h-10 flex-1 bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90 sm:flex-initial"
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
              className={cn(editButtonClass, 'w-full sm:w-auto')}
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
  const inputId = useId();

  return (
    <div className={cn('space-y-1', className)}>
      <label className={labelClass} htmlFor={inputId}>
        {label}
      </label>
      <Input
        id={inputId}
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

function FinancialAccordion({
  title,
  open,
  onToggle,
  count,
  viewAllHref,
  viewAllLabel,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  count: number;
  viewAllHref: string;
  viewAllLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-4 text-left sm:flex-nowrap sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
          {title}
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </span>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">
          {count} registros
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-200 bg-white">
          {children}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
            <Link href={viewAllHref} className="text-sm font-medium text-blue-600 hover:text-blue-700">
              {viewAllLabel}
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CobrancasTable({ cobrancas }: { cobrancas: ResponsavelCharge[] }) {
  if (!cobrancas.length) {
    return <EmptyPanel message="Nenhuma cobrança pendente recente." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {cobrancas.map((cobranca) => (
            <tr key={cobranca.id} className="border-b border-slate-200 last:border-b-0">
              <td className="px-5 py-3 font-semibold text-blue-700">{formatCurrency(cobranca.value)}</td>
              <td className="px-5 py-3 text-slate-800">
                {cobranca.description || 'Cobrança'}
                <div className="text-xs text-slate-500">
                  {cobranca.familyGroupId ? 'Familiar' : 'Avulsa'}
                </div>
              </td>
              <td className="px-5 py-3 text-slate-700">{cobranca.billingType ?? '—'}</td>
              <td className="px-5 py-3 text-slate-700">{formatDate(cobranca.dueDate)}</td>
              <td className="px-5 py-3">
                <Badge status={chargeStatusMap[cobranca.status] ?? 'PENDING'} size="sm" />
              </td>
              <td className="px-5 py-3 text-right">
                <Link href={`/cobrancas/${cobranca.id}`} className="inline-flex items-center text-sm text-brand-accent hover:underline">
                  Abrir
                  <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const assinaturaStatusLabels: Record<string, string> = {
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
  EXPIRED: 'Expirada',
  DELETED: 'Cancelada',
  REQUESTED: 'Solicitada',
};

const parcelamentoStatusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  EXPIRED: 'Expirado',
  DELETED: 'Cancelado',
  REQUESTED: 'Solicitado',
  CANCELED: 'Cancelado',
};

const chargeStatusMap: Record<string, StatusType> = {
  CREATED: 'PENDING',
  PENDING_SYNC: 'PROCESSANDO',
  OPEN: 'PENDING',
  OVERDUE: 'ATRASADO',
  PAID: 'PAGO',
  RECEIVED: 'PAGO',
  CONFIRMED: 'PAGO',
  CANCELED: 'CANCELADO',
  CANCELLED: 'CANCELADO',
  DELETED: 'CANCELADO',
};

function getFinancialBadgeLabel(status: string, labels: Record<string, string>) {
  return labels[status] ?? status;
}

function AssinaturasTable({ assinaturas }: { assinaturas: ResponsavelSubscription[] }) {
  if (!assinaturas.length) return <EmptyPanel message="Nenhuma assinatura vinculada." />;

  return (
    <div className="divide-y divide-slate-200">
      {assinaturas.map((assinatura) => (
        <div key={assinatura.id} className="grid grid-cols-1 gap-3 px-5 py-3 text-sm md:grid-cols-5 md:items-center">
          <div className="md:col-span-2">
            <p className="font-medium text-slate-900">{assinatura.description || 'Assinatura'}</p>
            <p className="text-xs text-slate-500">{assinatura.asaasSubscriptionId || assinatura.id}</p>
          </div>
          <div className="text-slate-600">{formatDate(assinatura.createdAt)}</div>
          <div><Badge variant={assinatura.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">{getFinancialBadgeLabel(assinatura.status, assinaturaStatusLabels)}</Badge></div>
          <div className="text-right">
            <Link href={`/cobrancas/assinaturas/${assinatura.id}`} className="text-sm text-brand-accent hover:underline">
              Abrir
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function ParcelamentosTable({ parcelamentos }: { parcelamentos: ResponsavelInstallmentPlan[] }) {
  if (!parcelamentos.length) return <EmptyPanel message="Nenhum parcelamento vinculado." />;

  return (
    <div className="divide-y divide-slate-200">
      {parcelamentos.map((parcelamento) => (
        <div key={parcelamento.id} className="grid grid-cols-1 gap-3 px-5 py-3 text-sm md:grid-cols-5 md:items-center">
          <div className="md:col-span-2">
            <p className="font-medium text-slate-900">
              {parcelamento.installmentCount} parcelas - {formatCurrency(parcelamento.value)}
            </p>
            <p className="text-xs text-slate-500">{parcelamento.billingType}</p>
          </div>
          <div className="text-slate-600">{formatDate(parcelamento.firstDueDate)}</div>
          <div><Badge variant={parcelamento.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">{getFinancialBadgeLabel(parcelamento.status, parcelamentoStatusLabels)}</Badge></div>
          <div className="text-right">
            <Link href={`/cobrancas/parcelamentos/${parcelamento.id}`} className="text-sm text-brand-accent hover:underline">
              Abrir
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="px-5 py-8 text-center text-sm text-slate-500">{message}</div>;
}

function ExcluirResponsavelDialog({
  open,
  onOpenChange,
  nome,
  deleting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  nome: string;
  deleting: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir responsável</DialogTitle>
          <DialogDescription className="space-y-2 pt-1 text-left text-slate-600">
            <span className="block">
              Tem certeza de que deseja excluir <span className="font-medium text-slate-900">{nome}</span>? Esta ação não
              pode ser desfeita.
            </span>
            <span className="block text-sm">
              A exclusão só é permitida quando não houver alunos vinculados, cobranças em aberto ou pendentes, matrículas
              financeiras ativas, lotes familiares em andamento ou vendas pendentes.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg border-slate-200 shadow-none"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white shadow-none hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Excluindo...' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResponsavelDetalhesSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full min-w-0 px-4 py-6 pb-8">
        <div className={cn('mb-8 space-y-4', DETAIL_SECTION_MAX)}>
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-[30rem] max-w-full" />
        </div>
        <div className={cn('space-y-4', DETAIL_SECTION_MAX)}>
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-72 max-w-full" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[...Array(3)].map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

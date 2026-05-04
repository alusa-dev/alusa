'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
  ClipboardDocumentCheck,
  CreditCard,
  Edit,
  ExternalLink,
  Mail,
  Phone,
  UserPlus,
  Users,
} from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import { formatInitials, maskCpf } from '@alusa/lib/client';

import {
  getResponsavel,
  getResponsavelOverview,
  createRematriculaFamiliar,
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
  financeiro: boolean;
};

function formatPhone(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return value || '-';
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('pt-BR');
}

function formatAddress(responsavel: ResponsavelDetail) {
  const endereco = responsavel.endereco;
  const linha1 = [endereco.logradouro, endereco.numero].filter(Boolean).join(', ');
  const linha2 = [endereco.bairro, endereco.cidade, endereco.uf].filter(Boolean).join(' · ');
  return [linha1, endereco.complemento, linha2, endereco.cep ? `CEP ${endereco.cep}` : null]
    .filter(Boolean)
    .join('\n');
}

const detailSectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';

export function ResponsavelDetalhesFeature({ responsavelId }: { responsavelId: string }) {
  const router = useRouter();
  const [responsavel, setResponsavel] = useState<ResponsavelDetail | null>(null);
  const [overview, setOverview] = useState<ResponsavelOverview | null>(null);
  const [alunos, setAlunos] = useState<AlunoVinculado[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [rematriculaOpen, setRematriculaOpen] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(null);

  const load = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    setOverview(null);
    setAlunos([]);

    try {
      const detail = await getResponsavel({ id: responsavelId, signal: controller.signal });
      setResponsavel(detail);
      setForm({
        nome: detail.nome,
        cpf: detail.cpf,
        email: detail.email,
        telefone: detail.telefone,
        financeiro: detail.financeiro,
      });

      const [overviewResult, alunosResult] = await Promise.allSettled([
        getResponsavelOverview({ id: responsavelId, signal: controller.signal }),
        fetch(`/api/responsaveis/${responsavelId}/alunos`, {
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]);

      if (overviewResult.status === 'fulfilled') {
        setOverview(overviewResult.value);
      }

      if (alunosResult.status === 'fulfilled' && alunosResult.value.ok) {
        const json = await alunosResult.value.json().catch(() => ({ items: [] }));
        setAlunos(Array.isArray(json.items) ? json.items : []);
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

  const endereco = useMemo(() => (responsavel ? formatAddress(responsavel) : ''), [responsavel]);
  const rematriculaDisponivel = useMemo(
    () => Boolean(overview?.rematriculaCandidates.some((candidate) => candidate.podeRenovar)),
    [overview],
  );

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      const updated = await updateResponsavel(responsavelId, form);
      setResponsavel(updated);
      setEditOpen(false);
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

  if (loading) {
    return <ResponsavelDetalhesSkeleton />;
  }

  if (!responsavel) {
    return (
      <div className="space-y-4">
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
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-7xl px-4 py-6 pb-8">
        <div className="mb-8">
          <Button
            variant="ghost"
            className="mb-5 h-9 px-2 text-slate-600 hover:bg-slate-50"
            onClick={() => router.push('/responsaveis')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <h1 className="mb-2 text-3xl font-bold leading-tight text-gray-900">
                Detalhes do responsável
              </h1>
              <p className="text-base text-gray-600">
                Gerencie cadastro, alunos vinculados, rematrículas e dados financeiros familiares.
              </p>
              <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="bg-violet-100 text-base font-semibold text-violet-700">
                    {formatInitials(responsavel.nome)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold tracking-tight text-gray-900">
                      {responsavel.nome}
                    </h2>
                    {responsavel.financeiro ? (
                      <Badge variant="info">Responsável financeiro</Badge>
                    ) : null}
                    {responsavel.asaasCustomerId ? (
                      <Badge variant="success">Customer financeiro</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {responsavel.email || 'E-mail não informado'} · {formatPhone(responsavel.telefone)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50"
                onClick={() => setEditOpen(true)}
              >
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
              <Button
                className="h-10 rounded-md bg-brand-accent px-4 text-sm font-medium text-white shadow-none hover:bg-brand-accent/90"
                disabled={!rematriculaDisponivel}
                onClick={() => setRematriculaOpen(true)}
                title={
                  rematriculaDisponivel
                    ? 'Iniciar novo lote de rematrícula familiar'
                    : 'Nenhum aluno elegível para rematrícula familiar'
                }
              >
                <ClipboardDocumentCheck className="mr-2 h-4 w-4" />
                Iniciar rematrícula familiar
              </Button>
            </div>
          </div>
        </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Alunos vinculados"
          value={responsavel.metrics.alunos}
          icon={<Users className="h-5 w-5" />}
        />
        <MetricCard
          label="Matrículas como pagador"
          value={responsavel.metrics.matriculasFinanceiras}
          icon={<ClipboardDocumentCheck className="h-5 w-5" />}
        />
        <MetricCard
          label="Vendas vinculadas"
          value={responsavel.metrics.vendas}
          icon={<CreditCard className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className={detailSectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Dados cadastrais</h2>
              <p className="mt-1 text-xs text-slate-500">
                Contato principal e identificação do responsável.
              </p>
            </div>
          </div>
          <div className="space-y-4 text-sm">
            <InfoRow label="CPF" value={maskCpf(responsavel.cpf)} />
            <InfoRow
              label="E-mail"
              value={responsavel.email || '-'}
              icon={<Mail className="h-4 w-4" />}
            />
            <InfoRow
              label="Telefone"
              value={formatPhone(responsavel.telefone)}
              icon={<Phone className="h-4 w-4" />}
            />
            <InfoRow label="Endereço" value={endereco || 'Endereço não informado'} multiline />
            <InfoRow label="Atualizado em" value={formatDate(responsavel.updatedAt)} />
          </div>
        </section>

        <section className={detailSectionClass}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Alunos vinculados</h2>
              <p className="mt-1 text-xs text-slate-500">
                Alunos cadastrados no fluxo de aluno ou vinculados diretamente a este responsável.
              </p>
            </div>
            <Button
              variant="outline"
              className="h-9 rounded-lg border-slate-200 bg-white shadow-none"
              disabled
              title="Vínculo direto será habilitado após consolidar a API de edição familiar."
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Vincular aluno
            </Button>
          </div>

          {alunos.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {alunos.map((aluno) => (
                <Link
                  key={aluno.id}
                  href={`/alunos/${aluno.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-slate-50"
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
                  <Badge status={aluno.ativo ? 'ATIVO' : 'INATIVO'} size="sm" />
                  <ExternalLink className="h-4 w-4 text-slate-400" />
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
      </div>

      <section className={detailSectionClass}>
        <h2 className="text-sm font-semibold text-slate-900">Visão financeira familiar</h2>
        <p className="mt-1 text-xs text-slate-500">
          Cobranças abertas, grupos familiares já processados e alunos aptos para a próxima rematrícula.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Lotes familiares"
            value={(overview?.summary.familyEnrollments ?? 0) + (overview?.summary.familyReenrollments ?? 0)}
            icon={<ClipboardDocumentCheck className="h-5 w-5" />}
          />
          <MetricCard
            label="Cobranças abertas"
            value={overview?.summary.openCharges ?? 0}
            icon={<CreditCard className="h-5 w-5" />}
          />
          <MetricCard
            label="Rematrículas elegíveis"
            value={overview?.rematriculaCandidates.filter((candidate) => candidate.podeRenovar).length ?? 0}
            icon={<Users className="h-5 w-5" />}
          />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Lotes familiares recentes</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {[...(overview?.families ?? []), ...(overview?.reenrollments ?? [])]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .slice(0, 6)
                  .map((family) => (
                    <div key={`${family.type}-${family.id}`} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">
                            {family.type === 'MATRICULA' ? 'Matrícula familiar' : 'Rematrícula familiar'}
                          </span>
                          <Badge variant={family.status === 'ATIVO' ? 'success' : family.status === 'FALHO' ? 'destructive' : 'info'}>
                            {family.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {family.totalAlunos} aluno(s) · mensalidade {formatCurrency(family.valorMensalidadeTotal)}
                          {family.valorTaxaMatriculaTotal > 0
                            ? ` · taxa ${formatCurrency(family.valorTaxaMatriculaTotal)}`
                            : ''}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400">{formatDate(family.createdAt)}</span>
                    </div>
                  ))}

                {!overview || (overview.families.length === 0 && overview.reenrollments.length === 0) ? (
                  <div className="px-4 py-6 text-sm text-slate-500">Nenhum lote familiar processado ainda.</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Cobranças abertas</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(overview?.charges ?? []).slice(0, 6).map((charge) => (
                  <div key={charge.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {charge.description || 'Cobrança familiar'}
                        </span>
                        <Badge variant={charge.status === 'OVERDUE' ? 'destructive' : 'warning'}>
                          {charge.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatCurrency(charge.value)}
                        {charge.dueDate ? ` · vence em ${formatDate(charge.dueDate)}` : ''}
                      </p>
                    </div>
                    {charge.invoiceUrl ? (
                      <Link
                        href={charge.invoiceUrl}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-accent hover:underline"
                      >
                        Abrir
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                  </div>
                ))}

                {!overview || overview.charges.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">Nenhuma cobrança consolidada em aberto.</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Elegibilidade de rematrícula</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {(overview?.rematriculaCandidates ?? []).slice(0, 8).map((candidate) => (
                <div key={candidate.matriculaId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{candidate.alunoNome}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[candidate.comboNome, candidate.planoNome, candidate.turmaNome].filter(Boolean).join(' · ') || 'Plano atual não identificado'}
                      </p>
                    </div>
                    <Badge variant={candidate.podeRenovar ? 'success' : 'outline'}>
                      {candidate.podeRenovar ? 'Pode renovar' : 'Bloqueado'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{candidate.message}</p>
                </div>
              ))}

              {!overview || overview.rematriculaCandidates.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">Nenhuma matrícula vinculada apareceu para rematrícula.</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar responsável</DialogTitle>
            <DialogDescription>
              Atualize os dados usados em cobranças familiares, contratos e comunicações.
            </DialogDescription>
          </DialogHeader>

          {form ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  className="mb-1.5 block text-xs font-medium text-slate-600"
                  htmlFor="edit-responsavel-nome"
                >
                  Nome completo
                </label>
                <Input
                  id="edit-responsavel-nome"
                  value={form.nome}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, nome: event.target.value } : current,
                    )
                  }
                  className="h-10 rounded-lg border-slate-200 shadow-none"
                />
              </div>
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium text-slate-600"
                  htmlFor="edit-responsavel-cpf"
                >
                  CPF
                </label>
                <Input
                  id="edit-responsavel-cpf"
                  value={form.cpf}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, cpf: event.target.value } : current,
                    )
                  }
                  className="h-10 rounded-lg border-slate-200 shadow-none"
                />
              </div>
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium text-slate-600"
                  htmlFor="edit-responsavel-telefone"
                >
                  Telefone
                </label>
                <Input
                  id="edit-responsavel-telefone"
                  value={form.telefone}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, telefone: event.target.value } : current,
                    )
                  }
                  className="h-10 rounded-lg border-slate-200 shadow-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  className="mb-1.5 block text-xs font-medium text-slate-600"
                  htmlFor="edit-responsavel-email"
                >
                  E-mail
                </label>
                <Input
                  id="edit-responsavel-email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, email: event.target.value } : current,
                    )
                  }
                  className="h-10 rounded-lg border-slate-200 shadow-none"
                />
              </div>
              <label className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-accent"
                  checked={form.financeiro}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, financeiro: event.target.checked } : current,
                    )
                  }
                />
                <span>
                  <span className="block font-medium text-slate-800">Responsável financeiro</span>
                  <span className="block text-xs text-slate-500">
                    Usado como pagador padrão nos fluxos familiares.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              className="h-10 rounded-lg border-slate-200 shadow-none"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RematriculaFamiliarDialog
        open={rematriculaOpen}
        onOpenChange={setRematriculaOpen}
        responsavel={responsavel}
        overview={overview}
        onCompleted={async () => {
          await load();
          setRematriculaOpen(false);
        }}
      />
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
          {icon}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon,
  multiline,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  multiline?: boolean;
}) {
  return (
    <div className="grid gap-1 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="flex items-start gap-2 text-slate-800">
        {icon ? <span className="mt-0.5 text-slate-400">{icon}</span> : null}
        <span className={multiline ? 'whitespace-pre-line' : ''}>{value}</span>
      </span>
    </div>
  );
}

function RematriculaFamiliarDialog({
  open,
  onOpenChange,
  responsavel,
  overview,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  responsavel: ResponsavelDetail;
  overview: ResponsavelOverview | null;
  onCompleted: () => Promise<void>;
}) {
  const elegiveis = useMemo(
    () => (overview?.rematriculaCandidates ?? []).filter((candidate) => candidate.podeRenovar),
    [overview],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [dataFimContrato, setDataFimContrato] = useState(() => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return nextYear.toISOString().slice(0, 10);
  });
  const [vencimentoDia, setVencimentoDia] = useState('5');
  const [formaPagamento, setFormaPagamento] = useState<'BOLETO' | 'PIX' | 'CARTAO_CREDITO'>('BOLETO');
  const [taxaMatricula, setTaxaMatricula] = useState('0');

  useEffect(() => {
    if (!open) return;
    setSelected(elegiveis.map((candidate) => candidate.matriculaId));
  }, [open, elegiveis]);

  async function handleSubmit() {
    if (selected.length < 2) {
      pushToast({
        title: 'Selecione ao menos dois alunos',
        description: 'A rematrícula familiar exige pelo menos duas matrículas elegíveis.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      await createRematriculaFamiliar({
        responsavelId: responsavel.id,
        itens: elegiveis
          .filter((candidate) => selected.includes(candidate.matriculaId))
          .map((candidate) => ({ matriculaId: candidate.matriculaId })),
        dataInicio,
        dataFimContrato,
        formaPagamento,
        formaPagamentoTaxa: formaPagamento,
        vencimentoDia: Number(vencimentoDia || '5'),
        taxaMatricula: Number((taxaMatricula || '0').replace(',', '.')),
        taxaIsenta: Number((taxaMatricula || '0').replace(',', '.')) <= 0,
        overrideReason: overrideReason.trim() || undefined,
      });

      pushToast({
        title: 'Rematrícula familiar criada',
        description: 'O lote familiar foi enviado e já entrou na fila financeira consolidada.',
        variant: 'success',
      });
      await onCompleted();
    } catch (error) {
      pushToast({
        title: 'Não foi possível iniciar a rematrícula familiar',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rematrícula familiar</DialogTitle>
          <DialogDescription>
            Selecione as matrículas elegíveis de {responsavel.nome} para processar um único ciclo financeiro compartilhado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-slate-200">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">Alunos elegíveis</p>
            </div>
            <div className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
              {elegiveis.map((candidate) => {
                const checked = selected.includes(candidate.matriculaId);
                return (
                  <label key={candidate.matriculaId} className="flex cursor-pointer items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-accent"
                      checked={checked}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, candidate.matriculaId]
                            : current.filter((id) => id !== candidate.matriculaId),
                        )
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{candidate.alunoNome}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[candidate.comboNome, candidate.planoNome, candidate.turmaNome].filter(Boolean).join(' · ') || 'Plano atual'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{candidate.message}</p>
                    </div>
                  </label>
                );
              })}
              {elegiveis.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">Nenhuma matrícula elegível no momento.</div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Data de início</label>
              <Input type="date" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} className="h-10 rounded-lg border-slate-200 shadow-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Fim do contrato</label>
              <Input type="date" value={dataFimContrato} onChange={(event) => setDataFimContrato(event.target.value)} className="h-10 rounded-lg border-slate-200 shadow-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Dia de vencimento</label>
              <Input value={vencimentoDia} onChange={(event) => setVencimentoDia(event.target.value)} className="h-10 rounded-lg border-slate-200 shadow-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Taxa por aluno</label>
              <Input value={taxaMatricula} onChange={(event) => setTaxaMatricula(event.target.value)} className="h-10 rounded-lg border-slate-200 shadow-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Forma de pagamento</label>
              <select
                value={formaPagamento}
                onChange={(event) => setFormaPagamento(event.target.value as 'BOLETO' | 'PIX' | 'CARTAO_CREDITO')}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-none outline-none"
              >
                <option value="BOLETO">Boleto</option>
                <option value="PIX">Pix</option>
                <option value="CARTAO_CREDITO">Cartão de crédito</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Motivo de override (opcional)</label>
              <Input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="h-10 rounded-lg border-slate-200 shadow-none" placeholder="Ex.: autorização financeira interna" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-10 rounded-lg border-slate-200 shadow-none" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90" onClick={handleSubmit} disabled={saving || elegiveis.length < 2}>
            {saving ? 'Processando...' : 'Criar rematrícula familiar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResponsavelDetalhesSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-7xl px-4 py-6 pb-8">
        <div className="mb-8 space-y-4">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-5 w-[30rem] max-w-full" />
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-72" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

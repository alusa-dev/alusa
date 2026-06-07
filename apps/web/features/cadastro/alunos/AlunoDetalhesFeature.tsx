'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImageCropDialog } from '@/components/image/ImageCropDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type StatusType } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import ReasonField from '@/components/shared/ReasonField';
import { pushToast } from '@/components/ui/toast';
import { CustomerNotificationsEditor } from '@/features/cadastro/shared/CustomerNotificationsEditor';
import {
  ChevronDown,
  ChevronLeft as ArrowLeft,
  ChevronUp,
  ExternalLink,
  Refresh,
  Trash,
} from '@/components/icons/icons';
import { formatFormaPagamentoLabel } from '@/lib/finance/asaas-sync';
import { cn } from '@/lib/utils';

type Nullable<T> = T | null;
type EditSection = 'foto' | 'aluno' | 'responsavel' | null;

type ResponsavelResumo = {
  id: string;
  tipoVinculo: string;
  nome: string;
  cpf: Nullable<string>;
  email: Nullable<string>;
  telefone: Nullable<string>;
  financeiro: boolean;
  asaasCustomerId: Nullable<string>;
  endereco: {
    cep: Nullable<string>;
    logradouro: Nullable<string>;
    numero: Nullable<string>;
    complemento: Nullable<string>;
    bairro: Nullable<string>;
    cidade: Nullable<string>;
    uf: Nullable<string>;
  };
};

type MatriculaResumo = {
  id: string;
  status: string;
  statusFinanceiro: string;
  statusContrato: string;
  dataInicio: Nullable<string>;
  dataFim: Nullable<string>;
  dataFimContrato: Nullable<string>;
  vencimentoDia: number;
  taxaMatricula: Nullable<number>;
  taxaStatus: string;
  taxaIsenta: boolean;
  formaPagamento: Nullable<string>;
  asaasSubscriptionId: Nullable<string>;
  plano: Nullable<{ id: string; nome: string; valor: Nullable<number>; periodicidade: string }>;
  combo: Nullable<{ id: string; nome: string; valor: Nullable<number>; periodicidade: string }>;
  turma: Nullable<{ id: string; nome: string; modalidade: Nullable<string> }>;
  turmas: Array<{ id: string; nome: string; modalidade: Nullable<string> }>;
  responsavelFinanceiro: Nullable<{
    id: string;
    nome: string;
    cpf: string;
    email: string;
    telefone: string;
    asaasCustomerId: Nullable<string>;
  }>;
  contratoAtual: Nullable<{
    id: string;
    status: string;
    assinadoEm: Nullable<string>;
    createdAt: Nullable<string>;
  }>;
};

type CobrancaResumo = {
  id: string;
  source: 'ACADEMICA' | 'AVULSA' | 'FAMILIAR' | 'EVENTO';
  matriculaId: Nullable<string>;
  tipo: string;
  descricao: Nullable<string>;
  status: string;
  valor: Nullable<number>;
  valorFinal: Nullable<number>;
  vencimento: Nullable<string>;
  dataPagamento: Nullable<string>;
  formaPagamento: Nullable<string>;
  asaasPaymentId: Nullable<string>;
  planoNome: Nullable<string>;
  createdAt: Nullable<string>;
};

type AssinaturaResumo = {
  id: string;
  source: 'ACADEMICA' | 'MATRICULA' | 'AVULSA';
  matriculaId: Nullable<string>;
  status: string;
  asaasSubscriptionId: Nullable<string>;
  externalReference: Nullable<string>;
  planoNome: Nullable<string>;
  createdAt: Nullable<string>;
};

type ParcelamentoResumo = {
  id: string;
  source: 'ACADEMICO' | 'AVULSO';
  matriculaId: Nullable<string>;
  status: string;
  asaasInstallmentId: Nullable<string>;
  externalReference: string;
  installmentCount: number;
  billingType: string;
  value: Nullable<number>;
  firstDueDate: Nullable<string>;
  planoNome: Nullable<string>;
  createdAt: Nullable<string>;
};

type AlunoDetalhes = {
  id: string;
  nome: string;
  nomeSocial: Nullable<string>;
  dataNasc: Nullable<string>;
  cpf: Nullable<string>;
  email: Nullable<string>;
  telefone: Nullable<string>;
  foto: Nullable<string>;
  status: string;
  enderecoCep: Nullable<string>;
  enderecoLogradouro: Nullable<string>;
  enderecoNumero: Nullable<string>;
  enderecoComplemento: Nullable<string>;
  enderecoBairro: Nullable<string>;
  enderecoCidade: Nullable<string>;
  enderecoUf: Nullable<string>;
  observacao: Nullable<string>;
  genero: Nullable<string>;
  modalidadePrincipal: Nullable<string>;
  nivel: Nullable<string>;
  alergias: Nullable<string>;
  restricoesMedicas: Nullable<string>;
  contatoEmergenciaNome: Nullable<string>;
  contatoEmergenciaTelefone: Nullable<string>;
  origemCadastro: Nullable<string>;
  bolsaDescontoPercent: Nullable<number>;
  isentoTaxaMatricula: boolean;
  consentimentoImagem: boolean;
  dataConsentimentoImagem: Nullable<string>;
  consentimentoComunicacoes: boolean;
  tamanhoCamiseta: Nullable<string>;
  tamanhoCalcado: Nullable<string>;
  codigoInterno: Nullable<string>;
  tags: string[];
  asaasCustomerId: Nullable<string>;
  asaasCustomerExternalReference: Nullable<string>;
  dataInativacao: Nullable<string>;
  motivoInativacao: Nullable<string>;
  createdAt: Nullable<string>;
  updatedAt: Nullable<string>;
  responsaveis: ResponsavelResumo[];
  responsavelPrincipal: Nullable<ResponsavelResumo>;
  matriculas: MatriculaResumo[];
  cobrancas: CobrancaResumo[];
  assinaturas: AssinaturaResumo[];
  parcelamentos: ParcelamentoResumo[];
  notificacoes: {
    asaasCustomerId: Nullable<string>;
    preferences: unknown[];
    customerChannelDefaults: string[];
  };
  resumo: {
    matriculas: number;
    matriculasAtivas: number;
    cobrancas: number;
    cobrancasPendentes: number;
    assinaturas: number;
    parcelamentos: number;
  };
};

type AlunoForm = {
  nome: string;
  nomeSocial: string;
  dataNasc: string;
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
  observacao: string;
  genero: string;
  modalidadePrincipal: string;
  nivel: string;
  alergias: string;
  restricoesMedicas: string;
  contatoEmergenciaNome: string;
  contatoEmergenciaTelefone: string;
  origemCadastro: string;
  bolsaDescontoPercent: string;
  isentoTaxaMatricula: boolean;
  consentimentoImagem: boolean;
  consentimentoComunicacoes: boolean;
  tamanhoCamiseta: string;
  tamanhoCalcado: string;
  codigoInterno: string;
  tags: string;
  responsavelNome: string;
  responsavelCpf: string;
  responsavelEmail: string;
  responsavelTelefone: string;
  responsavelCep: string;
  responsavelLogradouro: string;
  responsavelNumero: string;
  responsavelComplemento: string;
  responsavelBairro: string;
  responsavelCidade: string;
  responsavelUf: string;
};

const emptyForm: AlunoForm = {
  nome: '',
  nomeSocial: '',
  dataNasc: '',
  cpf: '',
  email: '',
  telefone: '',
  enderecoCep: '',
  enderecoLogradouro: '',
  enderecoNumero: '',
  enderecoComplemento: '',
  enderecoBairro: '',
  enderecoCidade: '',
  enderecoUf: '',
  observacao: '',
  genero: '',
  modalidadePrincipal: '',
  nivel: '',
  alergias: '',
  restricoesMedicas: '',
  contatoEmergenciaNome: '',
  contatoEmergenciaTelefone: '',
  origemCadastro: '',
  bolsaDescontoPercent: '',
  isentoTaxaMatricula: false,
  consentimentoImagem: false,
  consentimentoComunicacoes: true,
  tamanhoCamiseta: '',
  tamanhoCalcado: '',
  codigoInterno: '',
  tags: '',
  responsavelNome: '',
  responsavelCpf: '',
  responsavelEmail: '',
  responsavelTelefone: '',
  responsavelCep: '',
  responsavelLogradouro: '',
  responsavelNumero: '',
  responsavelComplemento: '',
  responsavelBairro: '',
  responsavelCidade: '',
  responsavelUf: '',
};

/** Largura máxima alinhada ao cabeçalho nas páginas de detalhe (cadastro). */
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

const pendingChargeStatuses = new Set(['PENDENTE', 'A_VENCER', 'ATRASADO', 'CREATED', 'OPEN', 'OVERDUE']);

const chargeStatusMap: Record<string, StatusType> = {
  PENDENTE: 'PENDENTE',
  A_VENCER: 'A_VENCER',
  PROCESSANDO: 'PROCESSANDO',
  PAGO: 'PAGO',
  ATRASADO: 'ATRASADO',
  CANCELADO: 'CANCELADO',
  CANCELAMENTO_PENDENTE: 'CANCELAMENTO_PENDENTE',
  ESTORNADO: 'ESTORNADO',
  ESTORNADO_PARCIAL: 'ESTORNADO_PARCIAL',
  CREATED: 'CREATED',
  OPEN: 'OPEN',
  OVERDUE: 'OVERDUE',
  PAID: 'PAID',
  PENDING: 'PENDING',
  PENDING_SYNC: 'PENDING_SYNC',
  CANCELED: 'CANCELED',
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return currencyFormatter.format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

function onlyDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

function safeStatus(status: string | null | undefined, fallback: StatusType = 'PENDING') {
  return (status || fallback) as StatusType;
}

function buildAvatarFallback(...values: Array<string | null | undefined>) {
  const source = values
    .map((value) => value?.trim() ?? '')
    .find(Boolean);

  if (!source) return 'AL';

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

function toForm(aluno: AlunoDetalhes): AlunoForm {
  const responsavel = aluno.responsavelPrincipal;
  return {
    ...emptyForm,
    nome: aluno.nome ?? '',
    nomeSocial: aluno.nomeSocial ?? '',
    dataNasc: onlyDate(aluno.dataNasc),
    cpf: aluno.cpf ?? '',
    email: aluno.email ?? '',
    telefone: aluno.telefone ?? '',
    enderecoCep: aluno.enderecoCep ?? '',
    enderecoLogradouro: aluno.enderecoLogradouro ?? '',
    enderecoNumero: aluno.enderecoNumero ?? '',
    enderecoComplemento: aluno.enderecoComplemento ?? '',
    enderecoBairro: aluno.enderecoBairro ?? '',
    enderecoCidade: aluno.enderecoCidade ?? '',
    enderecoUf: aluno.enderecoUf ?? '',
    observacao: aluno.observacao ?? '',
    genero: aluno.genero ?? '',
    modalidadePrincipal: aluno.modalidadePrincipal ?? '',
    nivel: aluno.nivel ?? '',
    alergias: aluno.alergias ?? '',
    restricoesMedicas: aluno.restricoesMedicas ?? '',
    contatoEmergenciaNome: aluno.contatoEmergenciaNome ?? '',
    contatoEmergenciaTelefone: aluno.contatoEmergenciaTelefone ?? '',
    origemCadastro: aluno.origemCadastro ?? '',
    bolsaDescontoPercent:
      aluno.bolsaDescontoPercent === null || aluno.bolsaDescontoPercent === undefined
        ? ''
        : String(aluno.bolsaDescontoPercent).replace('.', ','),
    isentoTaxaMatricula: Boolean(aluno.isentoTaxaMatricula),
    consentimentoImagem: Boolean(aluno.consentimentoImagem),
    consentimentoComunicacoes: Boolean(aluno.consentimentoComunicacoes),
    tamanhoCamiseta: aluno.tamanhoCamiseta ?? '',
    tamanhoCalcado: aluno.tamanhoCalcado ?? '',
    codigoInterno: aluno.codigoInterno ?? '',
    tags: Array.isArray(aluno.tags) ? aluno.tags.join(', ') : '',
    responsavelNome: responsavel?.nome ?? '',
    responsavelCpf: responsavel?.cpf ?? '',
    responsavelEmail: responsavel?.email ?? '',
    responsavelTelefone: responsavel?.telefone ?? '',
    responsavelCep: responsavel?.endereco.cep ?? '',
    responsavelLogradouro: responsavel?.endereco.logradouro ?? '',
    responsavelNumero: responsavel?.endereco.numero ?? '',
    responsavelComplemento: responsavel?.endereco.complemento ?? '',
    responsavelBairro: responsavel?.endereco.bairro ?? '',
    responsavelCidade: responsavel?.endereco.cidade ?? '',
    responsavelUf: responsavel?.endereco.uf ?? '',
  };
}

function buildUpdatePayload(form: AlunoForm) {
  const tags = form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const bolsa = form.bolsaDescontoPercent.trim().replace(',', '.');
  const hasResponsavel = [
    form.responsavelNome,
    form.responsavelCpf,
    form.responsavelEmail,
    form.responsavelTelefone,
    form.responsavelCep,
    form.responsavelLogradouro,
    form.responsavelNumero,
    form.responsavelBairro,
    form.responsavelCidade,
    form.responsavelUf,
  ].some((value) => value.trim());

  return {
    nome: form.nome,
    nomeSocial: form.nomeSocial,
    ...(form.dataNasc ? { dataNasc: form.dataNasc } : {}),
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
    observacao: form.observacao,
    genero: form.genero,
    modalidadePrincipal: form.modalidadePrincipal,
    nivel: form.nivel,
    alergias: form.alergias,
    restricoesMedicas: form.restricoesMedicas,
    contatoEmergenciaNome: form.contatoEmergenciaNome,
    contatoEmergenciaTelefone: form.contatoEmergenciaTelefone,
    origemCadastro: form.origemCadastro,
    bolsaDescontoPercent: bolsa ? Number(bolsa) : undefined,
    isentoTaxaMatricula: form.isentoTaxaMatricula,
    consentimentoImagem: form.consentimentoImagem,
    consentimentoComunicacoes: form.consentimentoComunicacoes,
    tamanhoCamiseta: form.tamanhoCamiseta,
    tamanhoCalcado: form.tamanhoCalcado,
    codigoInterno: form.codigoInterno,
    tags,
    responsavel: hasResponsavel
      ? {
          nome: form.responsavelNome,
          cpf: form.responsavelCpf,
          email: form.responsavelEmail,
          telefone: form.responsavelTelefone,
          financeiro: true,
          endereco: {
            cep: form.responsavelCep,
            logradouro: form.responsavelLogradouro,
            numero: form.responsavelNumero,
            complemento: form.responsavelComplemento,
            bairro: form.responsavelBairro,
            cidade: form.responsavelCidade,
            uf: form.responsavelUf,
          },
        }
      : undefined,
  };
}

function readableError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const maybe = payload as { error?: unknown; message?: unknown };
    if (typeof maybe.error === 'string') return maybe.error;
    if (maybe.error && typeof maybe.error === 'object') {
      const nested = maybe.error as { message?: unknown };
      if (typeof nested.message === 'string') return nested.message;
    }
    if (typeof maybe.message === 'string') return maybe.message;
  }
  return fallback;
}

export function AlunoDetalhesFeature({ alunoId }: { alunoId: string }) {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [aluno, setAluno] = useState<AlunoDetalhes | null>(null);
  const [form, setForm] = useState<AlunoForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [photoValue, setPhotoValue] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [openPanels, setOpenPanels] = useState({
    assinaturas: false,
    parcelamentos: false,
    cobrancas: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/alunos/${alunoId}/detalhes`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readableError(payload, 'Erro ao carregar aluno'));
      setAluno(payload.aluno);
      setForm(toForm(payload.aluno));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar aluno');
    } finally {
      setLoading(false);
    }
  }, [alunoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!aluno) {
      setPhotoValue(null);
      setPhotoRemoved(false);
      setCropSource(null);
      setCropOpen(false);
      return;
    }

    setPhotoValue(aluno.foto ?? null);
    setPhotoRemoved(false);
    setCropSource(null);
    setCropOpen(false);
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
  }, [aluno]);

  const updateField = <K extends keyof AlunoForm>(key: K, value: AlunoForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const avatarFallback = useMemo(
    () => buildAvatarFallback(form.nome, form.nomeSocial, aluno?.email),
    [aluno?.email, form.nome, form.nomeSocial],
  );

  const hasPhotoChanges = useMemo(() => {
    const currentPhoto = aluno?.foto ?? null;
    const nextPhoto = photoRemoved ? null : photoValue ?? null;
    return currentPhoto !== nextPhoto;
  }, [aluno?.foto, photoRemoved, photoValue]);

  const photoControlsDisabled = saving || (editSection !== null && editSection !== 'foto');

  const handlePhotoInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxBytes = 5 * 1024 * 1024;
    if (!file.type.startsWith('image/')) {
      pushToast({
        title: 'Arquivo inválido',
        description: 'Selecione uma imagem JPG, PNG ou WebP.',
        variant: 'error',
      });
      event.target.value = '';
      return;
    }

    if (file.size > maxBytes) {
      pushToast({
        title: 'Imagem muito grande',
        description: 'A foto deve ter no máximo 5MB.',
        variant: 'error',
      });
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        pushToast({
          title: 'Não foi possível abrir a imagem',
          description: 'Tente novamente com outro arquivo.',
          variant: 'error',
        });
        return;
      }

      setCropSource(result);
      setCropOpen(true);
    };
    reader.onerror = () => {
      pushToast({
        title: 'Não foi possível abrir a imagem',
        description: 'Tente novamente com outro arquivo.',
        variant: 'error',
      });
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, []);

  const handlePhotoPick = useCallback(() => {
    photoInputRef.current?.click();
  }, []);

  const handlePhotoEdit = useCallback(() => {
    if (!photoValue) {
      handlePhotoPick();
      return;
    }

    setCropSource(photoValue);
    setCropOpen(true);
  }, [handlePhotoPick, photoValue]);

  const handlePhotoRemove = useCallback(() => {
    setPhotoValue(null);
    setPhotoRemoved(Boolean(aluno?.foto));
    setCropOpen(false);
    setCropSource(null);
    setEditSection('foto');
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
  }, [aluno?.foto]);

  const handlePhotoCropApply = useCallback((result: { dataUrl: string }) => {
    setPhotoValue(result.dataUrl);
    setPhotoRemoved(false);
    setCropSource(null);
    setCropOpen(false);
    setEditSection('foto');
  }, []);

  const handlePhotoDialogChange = useCallback((open: boolean) => {
    setCropOpen(open);
    if (!open) {
      setCropSource(null);
    }
  }, []);

  const resetForm = () => {
    if (aluno) setForm(toForm(aluno));
    setPhotoValue(aluno?.foto ?? null);
    setPhotoRemoved(false);
    setCropSource(null);
    setCropOpen(false);
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
    setEditSection(null);
  };

  const handleSave = async () => {
    if (!aluno) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/alunos/${aluno.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildUpdatePayload(form)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readableError(payload, 'Erro ao salvar aluno'));
      pushToast({ title: 'Aluno atualizado', variant: 'success' });
      setEditSection(null);
      await load();
      window.dispatchEvent(new CustomEvent('alunos:changed'));
    } catch (err) {
      pushToast({
        title: 'Não foi possível salvar',
        description: err instanceof Error ? err.message : 'Erro ao salvar aluno',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoSave = async () => {
    if (!aluno) return;

    const nextPhoto = photoRemoved ? null : photoValue ?? null;
    if (!hasPhotoChanges) {
      setEditSection(null);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/alunos/${aluno.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto: nextPhoto }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readableError(payload, 'Erro ao salvar foto do aluno'));
      pushToast({ title: 'Foto atualizada', description: 'A foto do aluno foi atualizada.', variant: 'success' });
      setEditSection(null);
      await load();
      window.dispatchEvent(new CustomEvent('alunos:changed'));
    } catch (err) {
      pushToast({
        title: 'Não foi possível salvar a foto',
        description: err instanceof Error ? err.message : 'Erro ao salvar foto do aluno',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!aluno) return;
    const query = deleteReason.trim()
      ? `?motivo=${encodeURIComponent(deleteReason.trim())}`
      : '';
    const response = await fetch(`/api/alunos/${aluno.id}${query}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(readableError(payload, 'Erro ao remover aluno'));
    pushToast({
      title: payload?.deletion?.outcome === 'HARD_DELETED' ? 'Aluno removido' : 'Aluno arquivado',
      variant: 'success',
    });
    window.dispatchEvent(new CustomEvent('alunos:changed'));
    router.push('/alunos');
  };

  const latestMatricula = useMemo(() => {
    if (!aluno) return null;
    return aluno.matriculas.find((item) => ['ATIVA', 'PAUSADA', 'PENDENTE_TAXA'].includes(item.status)) ?? aluno.matriculas[0] ?? null;
  }, [aluno]);

  const pendingCharges = useMemo(() => {
    if (!aluno) return [];
    return aluno.cobrancas
      .filter((charge) => pendingChargeStatuses.has(charge.status))
      .sort((a, b) => {
        const aTime = new Date(a.createdAt ?? a.vencimento ?? 0).getTime();
        const bTime = new Date(b.createdAt ?? b.vencimento ?? 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 4);
  }, [aluno]);

  const notificationResponsavel = useMemo(() => {
    if (!aluno) return null;
    const notificationCustomerId = aluno.notificacoes.asaasCustomerId;
    return (
      aluno.matriculas.find(
        (matricula) =>
          matricula.responsavelFinanceiro?.asaasCustomerId &&
          matricula.responsavelFinanceiro.asaasCustomerId === notificationCustomerId,
      )?.responsavelFinanceiro ??
      aluno.responsavelPrincipal ??
      null
    );
  }, [aluno]);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
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

  if (error || !aluno) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 px-4 py-6">
          <BackButton onClick={() => router.push('/alunos')} />
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm">
            <h2 className="text-2xl font-bold text-gray-900">Erro ao carregar aluno</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
              {error || 'O aluno solicitado não foi encontrado.'}
            </p>
            <Button className="mt-6 bg-brand-accent text-white hover:bg-brand-accent/90" onClick={() => void load()}>
              <Refresh className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 px-4 py-6 pb-8">
        <div className={cn(DETAIL_SECTION_MAX, 'mb-8')}>
          <BackButton onClick={() => router.push('/alunos')} />
          <div>
            <h1 className="mb-2 text-3xl font-bold leading-tight text-gray-900">
              Detalhes do aluno
            </h1>
            <p className="text-base text-gray-600">
              Gerencie e visualize cadastro, responsáveis, matrículas e dados financeiros do aluno
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <EditableSection
            title="Foto"
            editSection="foto"
            activeSection={editSection}
            saving={saving}
            onEdit={setEditSection}
            onCancel={resetForm}
            onSave={handlePhotoSave}
            hideActions={editSection !== 'foto'}
          >
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoInputChange}
            />

            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <div className="flex items-center justify-center">
                <div className="relative h-28 w-28 overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                  {photoValue ? (
                    <img
                      src={photoValue}
                      alt={form.nome ? `Foto de ${form.nome}` : 'Foto do aluno'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500">
                      {avatarFallback}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-3">
                <p className="text-sm text-slate-600">
                  A foto ajuda na identificação rápida do aluno em turmas, carteirinhas e relatórios internos.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={handlePhotoEdit}
                    disabled={!photoValue || photoControlsDisabled}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={handlePhotoPick}
                    disabled={photoControlsDisabled}
                  >
                    {photoValue ? 'Substituir' : 'Enviar foto'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="bg-red-50 text-red-600 shadow-none hover:bg-red-100"
                    onClick={handlePhotoRemove}
                    disabled={(!photoValue && !aluno.foto) || photoControlsDisabled}
                  >
                    Remover
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Formatos suportados: JPG ou PNG até 5MB.
                </p>

                {editSection !== 'foto' ? null : (
                  <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-700">
                    Revise a foto e use salvar para aplicar a alteração.
                  </div>
                )}
              </div>
            </div>
          </EditableSection>

          <EditableSection
            title="Dados do Aluno"
            editSection="aluno"
            activeSection={editSection}
            saving={saving}
            onEdit={setEditSection}
            onCancel={resetForm}
            onSave={handleSave}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Nome Completo" value={form.nome} editing={editSection === 'aluno'} onChange={(value) => updateField('nome', value)} />
              <Field label="CPF" value={form.cpf} editing={editSection === 'aluno'} onChange={(value) => updateField('cpf', value)} />
              <Field label="E-mail" type="email" value={form.email} editing={editSection === 'aluno'} onChange={(value) => updateField('email', value)} />
              <Field label="Telefone" value={form.telefone} editing={editSection === 'aluno'} onChange={(value) => updateField('telefone', value)} />
              <Field label="Data de nascimento" type="date" value={form.dataNasc} editing={editSection === 'aluno'} onChange={(value) => updateField('dataNasc', value)} />
              <LockedField label="Status" value={aluno.status} badge />
              <Field label="Código interno" value={form.codigoInterno} editing={editSection === 'aluno'} onChange={(value) => updateField('codigoInterno', value)} />
              <LockedField label="Customer Asaas" value={aluno.asaasCustomerId || 'Não sincronizado'} />
            </div>
          </EditableSection>

          <EditableSection
            title="Informações complementares"
            editSection="aluno"
            activeSection={editSection}
            saving={saving}
            onEdit={setEditSection}
            onCancel={resetForm}
            onSave={handleSave}
            hideActions={editSection === 'responsavel'}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label="CEP" value={form.enderecoCep} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoCep', value)} />
              <Field label="Rua" value={form.enderecoLogradouro} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoLogradouro', value)} className="md:col-span-2" />
              <Field label="Número" value={form.enderecoNumero} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoNumero', value)} />
              <Field label="Complemento" value={form.enderecoComplemento} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoComplemento', value)} />
              <Field label="Bairro" value={form.enderecoBairro} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoBairro', value)} />
              <Field label="Cidade" value={form.enderecoCidade} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoCidade', value)} />
              <Field label="UF" value={form.enderecoUf} editing={editSection === 'aluno'} onChange={(value) => updateField('enderecoUf', value)} />
              <Field label="Modalidade principal" value={form.modalidadePrincipal} editing={editSection === 'aluno'} onChange={(value) => updateField('modalidadePrincipal', value)} />
              <Field label="Nível" value={form.nivel} editing={editSection === 'aluno'} onChange={(value) => updateField('nivel', value)} />
              <Field label="Bolsa/desconto (%)" value={form.bolsaDescontoPercent} editing={editSection === 'aluno'} onChange={(value) => updateField('bolsaDescontoPercent', value)} />
              <Field label="Tags" value={form.tags} editing={editSection === 'aluno'} onChange={(value) => updateField('tags', value)} />
              <Field label="Contato de emergência" value={form.contatoEmergenciaNome} editing={editSection === 'aluno'} onChange={(value) => updateField('contatoEmergenciaNome', value)} />
              <Field label="Telefone de emergência" value={form.contatoEmergenciaTelefone} editing={editSection === 'aluno'} onChange={(value) => updateField('contatoEmergenciaTelefone', value)} />
              <Field label="Camiseta" value={form.tamanhoCamiseta} editing={editSection === 'aluno'} onChange={(value) => updateField('tamanhoCamiseta', value)} />
              <Field label="Calçado" value={form.tamanhoCalcado} editing={editSection === 'aluno'} onChange={(value) => updateField('tamanhoCalcado', value)} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <BooleanField label="Isento da taxa de matrícula" checked={form.isentoTaxaMatricula} editing={editSection === 'aluno'} onChange={(value) => updateField('isentoTaxaMatricula', value)} />
              <BooleanField label="Consentimento de imagem" checked={form.consentimentoImagem} editing={editSection === 'aluno'} onChange={(value) => updateField('consentimentoImagem', value)} />
              <BooleanField label="Comunicações permitidas" checked={form.consentimentoComunicacoes} editing={editSection === 'aluno'} onChange={(value) => updateField('consentimentoComunicacoes', value)} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <TextField label="Alergias" value={form.alergias} editing={editSection === 'aluno'} onChange={(value) => updateField('alergias', value)} />
              <TextField label="Restrições médicas" value={form.restricoesMedicas} editing={editSection === 'aluno'} onChange={(value) => updateField('restricoesMedicas', value)} />
              <TextField label="Observações" value={form.observacao} editing={editSection === 'aluno'} onChange={(value) => updateField('observacao', value)} />
            </div>
          </EditableSection>

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
              <Field label="Nome Completo" value={form.responsavelNome} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelNome', value)} />
              <Field label="CPF" value={form.responsavelCpf} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelCpf', value)} />
              <Field label="E-mail" type="email" value={form.responsavelEmail} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelEmail', value)} />
              <Field label="Telefone" value={form.responsavelTelefone} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelTelefone', value)} />
              <LockedField label="Vínculo" value={aluno.responsavelPrincipal?.tipoVinculo || 'Não informado'} />
              <LockedField label="Customer Asaas" value={aluno.responsavelPrincipal?.asaasCustomerId || 'Não sincronizado'} />
              <Field label="CEP" value={form.responsavelCep} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelCep', value)} />
              <Field label="Rua" value={form.responsavelLogradouro} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelLogradouro', value)} />
              <Field label="Número" value={form.responsavelNumero} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelNumero', value)} />
              <Field label="Complemento" value={form.responsavelComplemento} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelComplemento', value)} />
              <Field label="Bairro" value={form.responsavelBairro} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelBairro', value)} />
              <Field label="Cidade" value={form.responsavelCidade} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelCidade', value)} />
              <Field label="UF" value={form.responsavelUf} editing={editSection === 'responsavel'} onChange={(value) => updateField('responsavelUf', value)} />
            </div>
          </EditableSection>

          <MatriculaResumoSection matricula={latestMatricula} total={aluno.resumo.matriculas} />

          {notificationResponsavel ? (
            <CustomerNotificationsResponsavelNotice
              responsavel={notificationResponsavel}
              customerId={aluno.notificacoes.asaasCustomerId}
            />
          ) : (
            <div className={DETAIL_SECTION_MAX}>
              <CustomerNotificationsEditor
                customerId={aluno.notificacoes.asaasCustomerId}
                endpoint={`/api/alunos/${aluno.id}/notificacoes`}
                description="Configuração individual do customer do aluno no Asaas. Para alunos com responsável financeiro, use a tela do responsável."
              />
            </div>
          )}

          <FinancialAccordion
            title="Assinaturas"
            open={openPanels.assinaturas}
            onToggle={() => setOpenPanels((current) => ({ ...current, assinaturas: !current.assinaturas }))}
            count={aluno.assinaturas.length}
            viewAllHref="/cobrancas/assinaturas"
            viewAllLabel="Visualizar todas as assinaturas"
          >
            <AssinaturasTable assinaturas={aluno.assinaturas.slice(0, 4)} />
          </FinancialAccordion>

          <FinancialAccordion
            title="Parcelamentos"
            open={openPanels.parcelamentos}
            onToggle={() => setOpenPanels((current) => ({ ...current, parcelamentos: !current.parcelamentos }))}
            count={aluno.parcelamentos.length}
            viewAllHref="/cobrancas/parcelamentos"
            viewAllLabel="Visualizar todos os parcelamentos"
          >
            <ParcelamentosTable parcelamentos={aluno.parcelamentos.slice(0, 4)} />
          </FinancialAccordion>

          <FinancialAccordion
            title="Cobranças"
            open={openPanels.cobrancas}
            onToggle={() => setOpenPanels((current) => ({ ...current, cobrancas: !current.cobrancas }))}
            count={aluno.cobrancas.length}
            viewAllHref="/cobrancas"
            viewAllLabel="Visualizar todas as cobranças."
          >
            <CobrancasTable cobrancas={pendingCharges} />
          </FinancialAccordion>

          <div className={cn('border-t border-gray-200 pt-6', DETAIL_SECTION_MAX)}>
            <Button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="h-10 w-full rounded-md bg-red-600 px-4 text-sm font-medium text-white shadow-none hover:bg-red-700 md:w-auto"
            >
              <Trash className="mr-2 h-4 w-4" />
              Remover aluno
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        title="Remover aluno"
        description={
          <span>
            Confirme a remoção de <strong>{aluno.nome}</strong>. O sistema aplicará a regra
            existente de arquivamento ou remoção definitiva conforme os vínculos do aluno.
          </span>
        }
        confirmLabel="Remover aluno"
        loadingLabel="Removendo..."
        cancelLabel="Cancelar"
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteReason('');
        }}
        onConfirm={handleDelete}
      >
        <ReasonField
          id="aluno-detail-delete-reason"
          value={deleteReason}
          onChange={(event) => setDeleteReason(event.target.value)}
        />
      </ConfirmDeleteDialog>

      <ImageCropDialog
        open={cropOpen && Boolean(cropSource)}
        onOpenChange={handlePhotoDialogChange}
        src={cropSource}
        title="Ajustar foto do aluno"
        onApply={handlePhotoCropApply}
      />
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

function LockedField({ label, value, badge = false }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      {badge ? (
        <div className="mt-2">
          <Badge status={safeStatus(value, value === 'ATIVO' ? 'ATIVO' : 'INATIVO')} size="sm" />
        </div>
      ) : (
        <Input value={value} disabled className={disabledControlClass} readOnly />
      )}
    </div>
  );
}

function BooleanField({
  label,
  checked,
  editing,
  onChange,
}: {
  label: string;
  checked: boolean;
  editing: boolean;
  onChange: (_value: boolean) => void;
}) {
  return (
    <label className="flex h-10 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
      <Checkbox
        checked={checked}
        disabled={!editing}
        onCheckedChange={(value) => onChange(Boolean(value))}
      />
      {label}
    </label>
  );
}

function TextField({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (_value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <textarea
        value={value}
        disabled={!editing}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full resize-none rounded-lg border px-3 py-2 text-sm shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:cursor-not-allowed disabled:opacity-100',
          editing
            ? 'border-slate-200 bg-white text-slate-900'
            : 'border-gray-200 bg-gray-100 text-gray-500',
        )}
        placeholder="Não informado"
      />
    </div>
  );
}

function MatriculaResumoSection({ matricula, total }: { matricula: MatriculaResumo | null; total: number }) {
  return (
    <section className={sectionClass}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-slate-700">Informações da Matrícula</span>
        {matricula ? (
          <Link
            href={`/matriculas/${matricula.id}`}
            className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Abrir matrícula
            <ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        ) : null}
      </div>

      {matricula ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className={labelClass}>Status</label>
            <div className="mt-1">
              <Badge status={safeStatus(matricula.status)} />
            </div>
          </div>
          <LockedField label="Data de início" value={formatDate(matricula.dataInicio)} />
          <LockedField label="Dia de vencimento" value={`Dia ${matricula.vencimentoDia}`} />
          <LockedField label="Plano ou combo" value={matricula.plano?.nome ?? matricula.combo?.nome ?? 'Não informado'} />
          <LockedField
            label="Turma"
            value={
              matricula.turma?.nome ??
              (matricula.turmas.map((turma) => turma.nome).join(', ') || 'Não informada')
            }
          />
          <LockedField label="Forma de pagamento" value={formatFormaPagamentoLabel(matricula.formaPagamento ?? '')} />
          <LockedField label="Responsável financeiro" value={matricula.responsavelFinanceiro?.nome ?? 'Não informado'} />
          <LockedField label="Contrato" value={matricula.contratoAtual?.status ?? matricula.statusContrato} />
          <LockedField label="Matrículas do aluno" value={String(total)} />
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Nenhuma matrícula vinculada.
        </div>
      )}
    </section>
  );
}

function CustomerNotificationsResponsavelNotice({
  responsavel,
  customerId,
}: {
  responsavel: Pick<ResponsavelResumo, 'id' | 'nome' | 'asaasCustomerId'>;
  customerId: string | null;
}) {
  return (
    <section className={sectionClass}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <span className="text-sm font-semibold text-slate-700">Configuração de notificações</span>
          <p className="text-xs text-slate-600">
            As notificações de cobrança deste aluno usam o customer do responsável financeiro.
            A edição fica centralizada no cadastro do responsável para evitar configurações duplicadas.
          </p>
          <p className="text-xs text-slate-500">
            Responsável: {responsavel.nome}
            {customerId ? ` · Customer Asaas: ${customerId}` : ''}
          </p>
        </div>
        <Button asChild variant="outline" className="h-10 shrink-0">
          <Link href={`/responsaveis/${responsavel.id}`}>Abrir responsável</Link>
        </Button>
      </div>
      {!customerId ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          O responsável ainda não possui customer Asaas sincronizado.
        </div>
      ) : null}
    </section>
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
    <section className={cn('overflow-hidden rounded-xl border border-slate-200 bg-slate-50', DETAIL_SECTION_MAX)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {title}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">
          {count} registros
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-200 bg-white">
          {children}
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <Link href={viewAllHref} className="text-sm font-medium text-blue-600 hover:text-blue-700">
              {viewAllLabel}
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CobrancasTable({ cobrancas }: { cobrancas: CobrancaResumo[] }) {
  if (!cobrancas.length) {
    return <EmptyPanel message="Nenhuma cobrança pendente recente." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {cobrancas.map((cobranca) => (
            <tr key={`${cobranca.source}-${cobranca.id}`} className="border-b border-slate-200 last:border-b-0">
              <td className="px-5 py-3 font-semibold text-blue-700">{formatCurrency(cobranca.valorFinal ?? cobranca.valor)}</td>
              <td className="px-5 py-3 text-slate-800">
                {cobranca.descricao || cobranca.planoNome || cobranca.tipo}
                <div className="text-xs text-slate-500">
                  {cobranca.source === 'ACADEMICA'
                    ? 'Acadêmica'
                    : cobranca.source === 'FAMILIAR'
                      ? 'Familiar'
                      : cobranca.source === 'EVENTO'
                        ? 'Evento'
                        : 'Avulsa'}
                </div>
              </td>
              <td className="px-5 py-3 text-slate-700">{formatFormaPagamentoLabel(cobranca.formaPagamento ?? '')}</td>
              <td className="px-5 py-3 text-slate-700">{formatDate(cobranca.vencimento)}</td>
              <td className="px-5 py-3">
                <Badge status={chargeStatusMap[cobranca.status] ?? 'PENDING'} size="sm" />
              </td>
              <td className="px-5 py-3 text-right">
                {cobranca.source !== 'EVENTO' && !cobranca.id.startsWith('group:') ? (
                  <Link href={`/cobrancas/${cobranca.id}`} className="inline-flex items-center text-sm text-brand-accent hover:underline">
                    Abrir
                    <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">{cobranca.source === 'EVENTO' ? 'Evento' : 'Familiar'}</span>
                )}
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
};

function getFinancialBadgeLabel(status: string, labels: Record<string, string>) {
  return labels[status] ?? status;
}

function AssinaturasTable({ assinaturas }: { assinaturas: AssinaturaResumo[] }) {
  if (!assinaturas.length) return <EmptyPanel message="Nenhuma assinatura vinculada." />;
  return (
    <div className="divide-y divide-slate-200">
      {assinaturas.map((assinatura) => (
        <div key={`${assinatura.source}-${assinatura.id}`} className="grid grid-cols-1 gap-3 px-5 py-3 text-sm md:grid-cols-5 md:items-center">
          <div className="md:col-span-2">
            <p className="font-medium text-slate-900">{assinatura.planoNome || 'Assinatura'}</p>
            <p className="text-xs text-slate-500">{assinatura.asaasSubscriptionId || assinatura.id}</p>
          </div>
          <div className="text-slate-600">{formatDate(assinatura.createdAt)}</div>
          <div><Badge variant={assinatura.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">{getFinancialBadgeLabel(assinatura.status, assinaturaStatusLabels)}</Badge></div>
          <div className="text-right">
            {assinatura.source !== 'MATRICULA' ? (
              <Link href={`/cobrancas/assinaturas/${assinatura.id}`} className="text-sm text-brand-accent hover:underline">
                Abrir
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ParcelamentosTable({ parcelamentos }: { parcelamentos: ParcelamentoResumo[] }) {
  if (!parcelamentos.length) return <EmptyPanel message="Nenhum parcelamento vinculado." />;
  return (
    <div className="divide-y divide-slate-200">
      {parcelamentos.map((parcelamento) => (
        <div key={`${parcelamento.source}-${parcelamento.id}`} className="grid grid-cols-1 gap-3 px-5 py-3 text-sm md:grid-cols-5 md:items-center">
          <div className="md:col-span-2">
            <p className="font-medium text-slate-900">
              {parcelamento.installmentCount} parcelas - {formatCurrency(parcelamento.value)}
            </p>
            <p className="text-xs text-slate-500">{formatFormaPagamentoLabel(parcelamento.billingType)}</p>
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

export default AlunoDetalhesFeature;

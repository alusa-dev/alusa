'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { IMaskInput } from 'react-imask';
import { toast } from '@/components/ui/toast';
import { useSession } from 'next-auth/react';
import { ImageCropDialog } from '../image/ImageCropDialog';

export type Status = 'ATIVO' | 'INATIVO';
export type Cargo = 'PROFESSOR' | 'RECEPCAO' | 'FINANCEIRO' | 'ADMINISTRATIVO' | 'OUTRO';
export type Genero =
  | 'MASCULINO'
  | 'FEMININO'
  | 'NAO_BINARIO'
  | 'OUTRO'
  | 'PREFERE_NAO_INFORMAR'
  | '';
export type RoleUsuario = 'ADMIN' | 'FINANCEIRO' | 'RECEPCAO' | 'PROFESSOR' | '';

export type ColaboradorEdit = {
  id?: string;
  nome: string;
  nomeSocial?: string | null;
  foto?: string | null;
  dataNasc?: string | Date | null;
  genero?: Genero | null;
  cpf?: string | null;
  rg?: string | null;
  orgaoEmissor?: string | null;
  dataEmissao?: string | Date | null;
  email?: string | null;
  telefone1?: string | null;
  contatoEmergenciaTelefone?: string | null;
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
  cargo?: Cargo;
  especialidade?: string | null;
  status?: Status;
  dataAdmissao?: string | Date | null;
  dataDesligamento?: string | Date | null;
  observacoes?: string | null;
  salario?: number | string | null;
  temAcesso?: boolean | null;
  roleUsuario?: RoleUsuario | null;
};

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  mode: 'create' | 'edit';
  colaborador: ColaboradorEdit | null;
  onSaved?: (_p?: unknown) => void;
  contaId?: string;
};

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const inputClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const textareaClass =
  'min-h-[120px] rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';

function formatDateInput(value?: string | Date | null) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function maskPhone(value?: string | null) {
  const clean = digits(value ?? '');
  if (!clean) return '';
  if (clean.length <= 2) return `(${clean}`;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7, 11)}`;
}

function maskCep(value?: string | null) {
  const clean = digits(value ?? '');
  if (!clean) return '';
  if (clean.length !== 8) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

function maskCpf(value?: string | null) {
  const clean = digits(value ?? '');
  if (clean.length !== 11) return clean;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

function parseCurrency(value: string) {
  if (!value.trim()) return undefined;
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const asNumber = Number(normalized);
  return Number.isNaN(asNumber) ? undefined : asNumber;
}

function toISODateOrUndefined(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export default function ColaboradorEditDialog({
  open,
  onOpenChange,
  mode,
  colaborador,
  onSaved,
  contaId,
}: Props) {
  const { data: session } = useSession();
  const effectiveContaId = React.useMemo(
    () =>
      contaId || (session?.user as { contaId?: string } | undefined)?.contaId || 'conta-default',
    [contaId, session],
  );

  const [nome, setNome] = React.useState('');
  const [nomeSocial, setNomeSocial] = React.useState('');
  const [foto, setFoto] = React.useState('');
  const [fotoPreview, setFotoPreview] = React.useState('');
  const [fotoRemoved, setFotoRemoved] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [cropSource, setCropSource] = React.useState<string | null>(null);
  const [cropOpen, setCropOpen] = React.useState(false);
  const originalFotoRef = React.useRef('');
  const [dataNasc, setDataNasc] = React.useState('');
  const [genero, setGenero] = React.useState<Genero>('');
  const [cpf, setCpf] = React.useState('');
  const [rg, setRg] = React.useState('');
  const [orgaoEmissor, setOrgaoEmissor] = React.useState('');
  const [dataEmissao, setDataEmissao] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [telefone, setTelefone] = React.useState('');
  const [contatoEmergenciaTelefone, setContatoEmergenciaTelefone] = React.useState('');
  const [enderecoCep, setEnderecoCep] = React.useState('');
  const [enderecoLogradouro, setEnderecoLogradouro] = React.useState('');
  const [enderecoNumero, setEnderecoNumero] = React.useState('');
  const [enderecoComplemento, setEnderecoComplemento] = React.useState('');
  const [enderecoBairro, setEnderecoBairro] = React.useState('');
  const [enderecoCidade, setEnderecoCidade] = React.useState('');
  const [enderecoUf, setEnderecoUf] = React.useState('');
  const [cargo, setCargo] = React.useState<Cargo>('RECEPCAO');
  const [especialidade, setEspecialidade] = React.useState('');
  const [status, setStatus] = React.useState<Status>('ATIVO');
  const [dataAdmissao, setDataAdmissao] = React.useState('');
  const [dataDesligamento, setDataDesligamento] = React.useState('');
  const [observacoes, setObservacoes] = React.useState('');
  const [salario, setSalario] = React.useState('');
  const [temAcesso, setTemAcesso] = React.useState(false);
  const [roleUsuario, setRoleUsuario] = React.useState<RoleUsuario>('');

  const [loadingDetails, setLoadingDetails] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const avatarFallback = React.useMemo(() => {
    const base = (nome || nomeSocial || '').trim();
    if (!base) return 'CL';
    const parts = base.split(/\s+/).filter(Boolean);
    const [first, second] = parts;
    const initials = `${first?.[0] ?? ''}${second?.[0] ?? ''}`.toUpperCase();
    if (initials) return initials;
    return (first?.[0] ?? 'C').toUpperCase();
  }, [nome, nomeSocial]);

  const resetForm = React.useCallback(() => {
    setNome('');
    setNomeSocial('');
    setFoto('');
    setFotoPreview('');
    setFotoRemoved(false);
    setCropSource(null);
    setCropOpen(false);
    originalFotoRef.current = '';
    setDataNasc('');
    setGenero('');
    setCpf('');
    setRg('');
    setOrgaoEmissor('');
    setDataEmissao('');
    setEmail('');
    setTelefone('');
    setContatoEmergenciaTelefone('');
    setEnderecoCep('');
    setEnderecoLogradouro('');
    setEnderecoNumero('');
    setEnderecoComplemento('');
    setEnderecoBairro('');
    setEnderecoCidade('');
    setEnderecoUf('');
    setCargo('RECEPCAO');
    setEspecialidade('');
    setStatus('ATIVO');
    setDataAdmissao('');
    setDataDesligamento('');
    setObservacoes('');
    setSalario('');
    setTemAcesso(false);
    setRoleUsuario('');
  }, []);

  const hydrateFrom = React.useCallback(
    (data?: Partial<ColaboradorEdit> | null) => {
      if (!data) {
        resetForm();
        return;
      }

      setNome(data.nome ?? '');
      setNomeSocial((data.nomeSocial ?? '') || '');
      const safeFoto = (data.foto ?? '') || '';
      setFoto(safeFoto);
      setFotoPreview(safeFoto);
      setFotoRemoved(false);
      setCropSource(null);
      setCropOpen(false);
      originalFotoRef.current = safeFoto;
      setDataNasc(formatDateInput(data.dataNasc));
      setGenero((data.genero ?? '') as Genero);
      setCpf(maskCpf(data.cpf));
      setRg((data.rg ?? '') || '');
      setOrgaoEmissor((data.orgaoEmissor ?? '') || '');
      setDataEmissao(formatDateInput(data.dataEmissao));
      setEmail((data.email ?? '') || '');
      setTelefone(maskPhone(data.telefone1));
      setContatoEmergenciaTelefone(maskPhone(data.contatoEmergenciaTelefone));
      setEnderecoCep(maskCep(data.enderecoCep));
      setEnderecoLogradouro((data.enderecoLogradouro ?? '') || '');
      setEnderecoNumero((data.enderecoNumero ?? '') || '');
      setEnderecoComplemento((data.enderecoComplemento ?? '') || '');
      setEnderecoBairro((data.enderecoBairro ?? '') || '');
      setEnderecoCidade((data.enderecoCidade ?? '') || '');
      setEnderecoUf((data.enderecoUf ?? '') || '');
      setCargo((data.cargo ?? 'RECEPCAO') as Cargo);
      setEspecialidade((data.especialidade ?? '') || '');
      setStatus((data.status ?? 'ATIVO') as Status);
      setDataAdmissao(formatDateInput(data.dataAdmissao));
      setDataDesligamento(formatDateInput(data.dataDesligamento));
      setObservacoes((data.observacoes ?? '') || '');
      if (data.salario != null && data.salario !== '') {
        const raw = typeof data.salario === 'number' ? data.salario : Number(data.salario);
        setSalario(Number.isNaN(raw) ? `${data.salario ?? ''}` : raw.toFixed(2));
      } else {
        setSalario('');
      }
      setTemAcesso(Boolean(data.temAcesso));
      setRoleUsuario((data.roleUsuario ?? '') as RoleUsuario);
    },
    [resetForm],
  );

  React.useEffect(() => {
    if (!open) return;

    hydrateFrom(colaborador);

    if (mode !== 'edit' || !colaborador?.id) {
      return;
    }

    let cancelled = false;
    setLoadingDetails(true);
    (async () => {
      try {
        const response = await fetch(`/api/colaboradores/${colaborador.id}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Falha ao carregar colaborador');
        const json = await response.json();
        if (cancelled) return;
        hydrateFrom(json?.data as Partial<ColaboradorEdit>);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          toast.error('Não foi possível carregar os dados completos do colaborador.');
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, colaborador, mode, hydrateFrom]);

  const headerTitle = mode === 'create' ? 'Novo colaborador' : 'Editar colaborador';
  const headerDescription =
    mode === 'create'
      ? 'Preencha os dados para cadastrar um novo colaborador.'
      : 'Atualize as informações cadastrais, endereço e vínculo do colaborador.';

  function isEmail(value: string) {
    return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function handleClose(next: boolean) {
    if (!next) {
      resetForm();
    }
    onOpenChange(next);
  }

  const handleFileInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast.error('A foto deve ter no máximo 5MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        toast.error('Não foi possível carregar a foto.');
        return;
      }
      setCropSource(result);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, []);

  const handlePickNewPhoto = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleEditPhoto = React.useCallback(() => {
    if (!fotoPreview) {
      handlePickNewPhoto();
      return;
    }
    setCropSource(fotoPreview);
    setCropOpen(true);
  }, [fotoPreview, handlePickNewPhoto]);

  const handleRemovePhoto = React.useCallback(() => {
    const originalFoto = originalFotoRef.current;
    if (originalFoto && fotoPreview && fotoPreview !== originalFoto) {
      setFoto(originalFoto);
      setFotoPreview(originalFoto);
      setFotoRemoved(false);
      setCropSource(null);
      setCropOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    setFoto('');
    setFotoPreview('');
    setFotoRemoved(true);
    setCropSource(null);
    setCropOpen(false);
    originalFotoRef.current = '';
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [fotoPreview]);

  const handleCropApply = React.useCallback((res: { dataUrl: string }) => {
    setFoto(res.dataUrl);
    setFotoPreview(res.dataUrl);
    setFotoRemoved(false);
    setCropSource(null);
    setCropOpen(false);
  }, []);

  const handleCropClose = React.useCallback(() => {
    setCropOpen(false);
    setCropSource(null);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || loadingDetails) return;

    if (nome.trim().length < 2) {
      toast.error('Informe o nome completo.');
      return;
    }
    if (!isEmail(email.trim())) {
      toast.error('E-mail inválido.');
      return;
    }
    if (temAcesso && !email.trim()) {
      toast.error('Informe um e-mail para liberar acesso.');
      return;
    }
    if (temAcesso && !roleUsuario) {
      toast.error('Selecione o perfil de acesso.');
      return;
    }
    const telefoneDigits = digits(telefone);
    if (mode === 'create' && telefoneDigits.length < 11) {
      toast.error('Informe o telefone principal com DDD e 9 dígitos.');
      return;
    }
    if (telefoneDigits && telefoneDigits.length !== 11) {
      toast.error('Informe um telefone principal válido (DDD + 9 dígitos).');
      return;
    }
    if (mode === 'create' && !dataNasc) {
      toast.error('Informe a data de nascimento.');
      return;
    }
    if (mode === 'create' && !enderecoCep) {
      toast.error('Informe o CEP.');
      return;
    }
    if (mode === 'edit' && !colaborador?.id) {
      toast.error('Registro inválido.');
      return;
    }

    const payload: Record<string, unknown> = {
      nome: nome.trim(),
      cargo,
      status,
      temAcesso,
    };

    if (nomeSocial.trim()) payload.nomeSocial = nomeSocial.trim();
    if (foto) {
      payload.foto = foto;
    } else if (mode === 'edit' && (fotoRemoved || originalFotoRef.current)) {
      payload.foto = null;
    }

    const dataNascIso = toISODateOrUndefined(dataNasc);
    if (dataNascIso) payload.dataNasc = dataNascIso;

    if (genero) payload.genero = genero;

    const cpfDigits = digits(cpf);
    if (mode === 'create' && cpfDigits.length === 11) payload.cpf = cpfDigits;

    if (rg.trim()) payload.rg = rg.trim();
    if (orgaoEmissor.trim()) payload.orgaoEmissor = orgaoEmissor.trim();

    const dataEmissaoIso = toISODateOrUndefined(dataEmissao);
    if (dataEmissaoIso) payload.dataEmissao = dataEmissaoIso;

    if (email.trim()) payload.email = email.trim().toLowerCase();
    if (telefoneDigits) payload.telefone1 = telefoneDigits;

    const contatoEmergenciaDigits = digits(contatoEmergenciaTelefone);
    if (contatoEmergenciaDigits && contatoEmergenciaDigits.length !== 11) {
      toast.error('Informe um telefone de emergência válido (DDD + 9 dígitos).');
      return;
    }
    if (contatoEmergenciaDigits) payload.contatoEmergenciaTelefone = contatoEmergenciaDigits;

    const cepDigits = digits(enderecoCep);
    if (cepDigits && cepDigits.length !== 8) {
      toast.error('Informe um CEP válido.');
      return;
    }
    if (cepDigits) payload.enderecoCep = cepDigits;
    if (enderecoLogradouro.trim()) payload.enderecoLogradouro = enderecoLogradouro.trim();
    if (enderecoNumero.trim()) payload.enderecoNumero = enderecoNumero.trim();
    if (enderecoComplemento.trim()) payload.enderecoComplemento = enderecoComplemento.trim();
    if (enderecoBairro.trim()) payload.enderecoBairro = enderecoBairro.trim();
    if (enderecoCidade.trim()) payload.enderecoCidade = enderecoCidade.trim();
    if (enderecoUf.trim()) payload.enderecoUf = enderecoUf.trim().slice(0, 2).toUpperCase();

    if (especialidade.trim()) payload.especialidade = especialidade.trim();

    const dataAdmissaoIso = toISODateOrUndefined(dataAdmissao);
    if (dataAdmissaoIso) payload.dataAdmissao = dataAdmissaoIso;
    const dataDesligamentoIso = toISODateOrUndefined(dataDesligamento);
    if (dataDesligamentoIso) payload.dataDesligamento = dataDesligamentoIso;

    if (observacoes.trim()) payload.observacoes = observacoes.trim();

    const salarioNumber = parseCurrency(salario);
    if (salarioNumber !== undefined) payload.salario = salarioNumber;

    if (temAcesso && roleUsuario) {
      payload.roleUsuario = roleUsuario;
    } else if (!temAcesso) {
      payload.roleUsuario = null;
    }

    const url =
      mode === 'create'
        ? `/api/colaboradores?${new URLSearchParams({ contaId: effectiveContaId }).toString()}`
        : `/api/colaboradores/${colaborador?.id ?? ''}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';

    try {
      setSubmitting(true);
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          json?.error?.message || json?.error || json?.message || 'Falha ao salvar colaborador';
        toast.error(String(message));
        return;
      }

      toast.success(mode === 'create' ? 'Colaborador criado!' : 'Colaborador atualizado!');
      try {
        window.dispatchEvent(new CustomEvent('colaboradores:changed'));
      } catch (error) {
        console.debug(error);
      }
      onSaved?.(json?.data ?? json);
      handleClose(false);
    } catch (error) {
      console.error(error);
      toast.error('Erro de comunicação com o servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="w-[95vw] max-w-4xl gap-0 overflow-hidden p-0 sm:rounded-2xl"
        data-testid="colaborador-edit-dialog"
      >
        <form onSubmit={handleSubmit} className="flex max-h-[88vh] flex-col">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className="border-b border-slate-200 px-8 py-6">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              {headerTitle}
            </DialogTitle>
            <p className="mt-2 text-sm text-slate-600">{headerDescription}</p>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">
            {loadingDetails && mode === 'edit' ? (
              <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">
                Carregando dados do colaborador...
              </div>
            ) : (
              <>
                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Foto</span>
                  <div className="flex flex-col gap-5 md:flex-row md:items-center">
                    <div className="flex items-center justify-center">
                      <div className="relative h-28 w-28 overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                        {fotoPreview ? (
                          <img
                            src={fotoPreview}
                            alt={nome ? `Foto de ${nome}` : 'Foto do colaborador'}
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
                        A foto ajuda na identificação rápida do colaborador em turmas, matrículas e
                        relatórios internos.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          onClick={handleEditPhoto}
                          disabled={!fotoPreview}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          onClick={handlePickNewPhoto}
                        >
                          Substituir
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          className="bg-red-50 text-red-600 shadow-none hover:bg-red-100"
                          onClick={handleRemovePhoto}
                          disabled={!fotoPreview && !originalFotoRef.current}
                        >
                          Remover
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">
                        Formatos suportados: JPG ou PNG até 5MB.
                      </p>
                    </div>
                  </div>
                </section>
                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Identificação</span>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="md:col-span-2 space-y-1">
                      <label className={labelClass}>Nome</label>
                      <Input
                        value={nome}
                        onChange={(event) => setNome(event.target.value)}
                        placeholder="Nome completo"
                        className={inputClass}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Nome social</label>
                      <Input
                        value={nomeSocial}
                        onChange={(event) => setNomeSocial(event.target.value)}
                        placeholder="Opcional"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Data de nascimento</label>
                      <Input
                        type="date"
                        value={dataNasc}
                        onChange={(event) => setDataNasc(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Gênero</label>
                      <Select
                        value={genero || undefined}
                        onValueChange={(value) => setGenero(value as Genero)}
                      >
                        <SelectTrigger className={inputClass}>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MASCULINO">Masculino</SelectItem>
                          <SelectItem value="FEMININO">Feminino</SelectItem>
                          <SelectItem value="NAO_BINARIO">Não-binário</SelectItem>
                          <SelectItem value="OUTRO">Outro</SelectItem>
                          <SelectItem value="PREFERE_NAO_INFORMAR">Prefere não informar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>CPF</label>
                      <IMaskInput
                        mask="000.000.000-00"
                        value={cpf}
                        onAccept={(value) => setCpf(String(value))}
                        className={`${inputClass} flex h-10 w-full`}
                        placeholder="000.000.000-00"
                      />
                    </div>
                  </div>
                </section>

                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Documentos</span>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-2">
                      <label className={labelClass}>RG</label>
                      <Input
                        value={rg}
                        onChange={(event) => setRg(event.target.value)}
                        className={inputClass}
                        placeholder="Registro geral"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Órgão emissor</label>
                      <Input
                        value={orgaoEmissor}
                        onChange={(event) => setOrgaoEmissor(event.target.value)}
                        className={inputClass}
                        placeholder="SSP"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Data emissão</label>
                      <Input
                        type="date"
                        value={dataEmissao}
                        onChange={(event) => setDataEmissao(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </section>

                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Contato</span>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-1">
                      <label className={labelClass}>E-mail</label>
                      <Input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="email@exemplo.com"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Telefone</label>
                      <IMaskInput
                        mask={['(00) 0000-0000', '(00) 00000-0000']}
                        value={telefone}
                        onAccept={(value) => setTelefone(String(value))}
                        className={`${inputClass} flex h-10 w-full`}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Telefone de emergência</label>
                      <IMaskInput
                        mask={['(00) 0000-0000', '(00) 00000-0000']}
                        value={contatoEmergenciaTelefone}
                        onAccept={(value) => setContatoEmergenciaTelefone(String(value))}
                        className={`${inputClass} flex h-10 w-full`}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </div>
                </section>

                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Endereço</span>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                    <div className="space-y-1">
                      <label className={labelClass}>CEP</label>
                      <IMaskInput
                        mask="00000-000"
                        value={enderecoCep}
                        onAccept={(value) => setEnderecoCep(String(value))}
                        className={`${inputClass} flex h-10 w-full`}
                        placeholder="00000-000"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className={labelClass}>Logradouro</label>
                      <Input
                        value={enderecoLogradouro}
                        onChange={(event) => setEnderecoLogradouro(event.target.value)}
                        className={inputClass}
                        placeholder="Rua/Av"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Número</label>
                      <Input
                        value={enderecoNumero}
                        onChange={(event) => setEnderecoNumero(event.target.value)}
                        className={inputClass}
                        placeholder="Nº"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Complemento</label>
                      <Input
                        value={enderecoComplemento}
                        onChange={(event) => setEnderecoComplemento(event.target.value)}
                        className={inputClass}
                        placeholder="Opcional"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Bairro</label>
                      <Input
                        value={enderecoBairro}
                        onChange={(event) => setEnderecoBairro(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className={labelClass}>Cidade</label>
                      <Input
                        value={enderecoCidade}
                        onChange={(event) => setEnderecoCidade(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>UF</label>
                      <Input
                        value={enderecoUf}
                        onChange={(event) =>
                          setEnderecoUf(event.target.value.toUpperCase().slice(0, 2))
                        }
                        className={inputClass}
                        placeholder="UF"
                        maxLength={2}
                      />
                    </div>
                  </div>
                </section>

                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Vínculo e acesso</span>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-1">
                      <label className={labelClass}>Cargo</label>
                      <Select value={cargo} onValueChange={(value) => setCargo(value as Cargo)}>
                        <SelectTrigger className={inputClass}>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PROFESSOR">Professor</SelectItem>
                          <SelectItem value="RECEPCAO">Recepção</SelectItem>
                          <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                          <SelectItem value="ADMINISTRATIVO">Administrativo</SelectItem>
                          <SelectItem value="OUTRO">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Especialidade</label>
                      <Input
                        value={especialidade}
                        onChange={(event) => setEspecialidade(event.target.value)}
                        className={inputClass}
                        placeholder="Ex.: Ballet Clássico"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Status</label>
                      <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
                        <SelectTrigger className={inputClass}>
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ATIVO">Ativo</SelectItem>
                          <SelectItem value="INATIVO">Inativo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-1">
                      <label className={labelClass}>Data de admissão</label>
                      <Input
                        type="date"
                        value={dataAdmissao}
                        onChange={(event) => setDataAdmissao(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Data de desligamento</label>
                      <Input
                        type="date"
                        value={dataDesligamento}
                        onChange={(event) => setDataDesligamento(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Salário (R$)</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={salario}
                        onChange={(event) => setSalario(event.target.value)}
                        className={inputClass}
                        placeholder="0,00"
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        id="temAcesso"
                        type="checkbox"
                        checked={temAcesso}
                        onChange={(event) => {
                          setTemAcesso(event.target.checked);
                          if (!event.target.checked) {
                            setRoleUsuario('');
                          }
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-brand-accent focus:ring-[#A94DFF]"
                      />
                      <label htmlFor="temAcesso" className="text-sm text-slate-700">
                        Permitir acesso à plataforma
                      </label>
                    </div>
                    {temAcesso ? (
                      <div className="max-w-xs space-y-1">
                        <label className={labelClass}>Perfil de acesso</label>
                        <Select
                          value={roleUsuario || undefined}
                          onValueChange={(value) => setRoleUsuario(value as RoleUsuario)}
                        >
                          <SelectTrigger className={inputClass}>
                            <SelectValue placeholder="Selecione o perfil" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                            <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                            <SelectItem value="RECEPCAO">Recepção</SelectItem>
                            <SelectItem value="PROFESSOR">Professor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Observações</span>
                  <Textarea
                    value={observacoes}
                    onChange={(event) => setObservacoes(event.target.value)}
                    placeholder="Anotações internas, observações de vínculo ou informações adicionais."
                    className={textareaClass}
                  />
                </section>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-8 py-4">
            <Button
              type="button"
              variant="outline"
              className="min-w-[130px] border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
              onClick={() => handleClose(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="min-w-[140px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
              disabled={submitting || (mode === 'edit' && loadingDetails)}
            >
              {submitting ? 'Salvando...' : mode === 'create' ? 'Criar' : 'Salvar'}
            </Button>
          </div>
        </form>
        <ImageCropDialog
          src={cropSource}
          open={cropOpen && Boolean(cropSource)}
          onOpenChange={(o) => {
            if (!o) handleCropClose();
            else setCropOpen(true);
          }}
          onApply={handleCropApply}
          aspect={1}
          className="backdrop-blur-sm"
          round
        />
      </DialogContent>
    </Dialog>
  );
}

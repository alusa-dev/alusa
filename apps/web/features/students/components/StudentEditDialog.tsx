'use client';
// Conteúdo migrado de components/aluno/StudentEditDialog.tsx (original)
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { InfoCircle } from '@/components/icons/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { logClientOperationalEvent } from '@/lib/observability/client-operational-log';
import { IMaskInput } from 'react-imask';
import { ImageCropDialog } from '@/components/image/ImageCropDialog';
import { wizardFieldInputClass, wizardTextareaFieldClass } from '@/components/shared/wizard/field-styles';

type StatusAluno = 'ATIVO' | 'INATIVO';

export type EditAluno = {
  id: string;
  nome: string;
  nomeSocial?: string | null;
  dataNasc?: string | null;
  cpf?: string | null;
  email?: string | null;
  telefone?: string | null;
  foto?: string | null;
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
  observacao?: string | null;
  genero?: 'MASCULINO' | 'FEMININO' | 'NAO_BINARIO' | 'OUTRO' | 'PREFERE_NAO_INFORMAR' | null;
  modalidadePrincipal?: string | null;
  nivel?: string | null;
  alergias?: string | null;
  restricoesMedicas?: string | null;
  contatoEmergenciaNome?: string | null;
  contatoEmergenciaTelefone?: string | null;
  origemCadastro?: string | null;
  bolsaDescontoPercent?: number | null;
  isentoTaxaMatricula?: boolean | null;
  consentimentoImagem?: boolean | null;
  dataConsentimentoImagem?: string | null;
  consentimentoComunicacoes?: boolean | null;
  tamanhoCamiseta?: string | null;
  tamanhoCalcado?: string | null;
  codigoInterno?: string | null;
  asaasCustomerId?: string | null;
  tags?: string[] | null;
  status: StatusAluno;
  responsavel?: {
    nome?: string | null;
    cpf?: string | null;
    email?: string | null;
    telefone?: string | null;
    endereco?: {
      cep?: string | null;
      logradouro?: string | null;
      numero?: string | null;
      complemento?: string | null;
      bairro?: string | null;
      cidade?: string | null;
      uf?: string | null;
    } | null;
  } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  aluno: EditAluno | null;
  onSaved?: () => void;
};

export function StudentEditDialog({ open, onOpenChange, aluno, onSaved }: Props) {
  const [nome, setNome] = React.useState('');
  const [nomeSocial, setNomeSocial] = React.useState('');
  const [dataNasc, setDataNasc] = React.useState('');
  const [cpf, setCpf] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [telefone, setTelefone] = React.useState('');
  const [foto, setFoto] = React.useState('');
  const [fotoPreview, setFotoPreview] = React.useState('');
  const [fotoRemoved, setFotoRemoved] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [cropSource, setCropSource] = React.useState<string | null>(null);
  const [cropOpen, setCropOpen] = React.useState(false);
  const originalFotoRef = React.useRef('');
  const [cep, setCep] = React.useState('');
  const [logradouro, setLogradouro] = React.useState('');
  const [numero, setNumero] = React.useState('');
  const [complemento, setComplemento] = React.useState('');
  const [bairro, setBairro] = React.useState('');
  const [cidade, setCidade] = React.useState('');
  const [uf, setUf] = React.useState('');
  const [observacao, setObservacao] = React.useState('');
  const [genero, setGenero] = React.useState<EditAluno['genero'] | undefined>(undefined);
  const [alergias, setAlergias] = React.useState('');
  const [restricoes, setRestricoes] = React.useState('');
  const [contatoNome, setContatoNome] = React.useState('');
  const [contatoTelefone, setContatoTelefone] = React.useState('');
  const [status, setStatus] = React.useState<StatusAluno>('ATIVO');
  const [codigoInterno, setCodigoInterno] = React.useState('');
  const [respNome, setRespNome] = React.useState('');
  const [respCpf, setRespCpf] = React.useState('');
  const [respEmail, setRespEmail] = React.useState('');
  const [respTelefone, setRespTelefone] = React.useState('');
  const [respCep, setRespCep] = React.useState('');
  const [respLogradouro, setRespLogradouro] = React.useState('');
  const [respNumero, setRespNumero] = React.useState('');
  const [respComplemento, setRespComplemento] = React.useState('');
  const [respBairro, setRespBairro] = React.useState('');
  const [respCidade, setRespCidade] = React.useState('');
  const [respUf, setRespUf] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const controlClass =
    `${wizardFieldInputClass} disabled:cursor-not-allowed disabled:opacity-60`;
  const textAreaClass = wizardTextareaFieldClass;
  const sectionClass =
    'space-y-3 rounded-xl border border-slate-200 bg-white p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]';
  const labelClass =
    'block text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]';

  React.useEffect(() => {
    if (aluno && open) {
      setNome(aluno.nome || '');
      setNomeSocial((aluno.nomeSocial || '') as string);
      const iso = (aluno.dataNasc || '') as string;
      const d = iso ? new Date(iso) : null;
      setDataNasc(d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
      setCpf((aluno.cpf || '') as string);
      setEmail((aluno.email || '') as string);
      setTelefone((aluno.telefone || '') as string);
      const safeFoto = ((aluno.foto || '') as string) || '';
      setFoto(safeFoto);
      setFotoPreview(safeFoto);
      setFotoRemoved(false);
      setCropSource(null);
      setCropOpen(false);
      originalFotoRef.current = safeFoto;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setCep((aluno.enderecoCep || '') as string);
      setLogradouro((aluno.enderecoLogradouro || '') as string);
      setNumero((aluno.enderecoNumero || '') as string);
      setComplemento((aluno.enderecoComplemento || '') as string);
      setBairro((aluno.enderecoBairro || '') as string);
      setCidade((aluno.enderecoCidade || '') as string);
      setUf((aluno.enderecoUf || '') as string);
      setObservacao((aluno.observacao || '') as string);
      setGenero((aluno.genero || undefined) as EditAluno['genero'] | undefined);
      setAlergias((aluno.alergias || '') as string);
      setRestricoes((aluno.restricoesMedicas || '') as string);
      setContatoNome((aluno.contatoEmergenciaNome || '') as string);
      setContatoTelefone((aluno.contatoEmergenciaTelefone || '') as string);
      setStatus(aluno.status || 'ATIVO');
      setCodigoInterno((aluno.codigoInterno || '') as string);
      const resp = aluno.responsavel || null;
      if (resp) {
        setRespNome((resp.nome || '') as string);
        setRespCpf((resp.cpf || '') as string);
        setRespEmail((resp.email || '') as string);
        setRespTelefone((resp.telefone || '') as string);
        const re = resp.endereco || {};
        setRespCep((re.cep || '') as string);
        setRespLogradouro((re.logradouro || '') as string);
        setRespNumero((re.numero || '') as string);
        setRespComplemento((re.complemento || '') as string);
        setRespBairro((re.bairro || '') as string);
        setRespCidade((re.cidade || '') as string);
        setRespUf((re.uf || '') as string);
      } else {
        setRespNome('');
        setRespCpf('');
        setRespEmail('');
        setRespTelefone('');
        setRespCep('');
        setRespLogradouro('');
        setRespNumero('');
        setRespComplemento('');
        setRespBairro('');
        setRespCidade('');
        setRespUf('');
      }
    }
  }, [aluno, open]);

  function digits(v: string) {
    return v.replace(/\D/g, '');
  }
  function isEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }
  function isUf(v: string) {
    return /^[A-Za-z]{2}$/.test(v);
  }
  function isCepDigits(v: string) {
    return /^\d{8}$/.test(v);
  }

  const avatarFallback = React.useMemo(() => {
    const base = (nome || nomeSocial || '').trim();
    if (!base) return 'AL';
    const parts = base.split(/\s+/).filter(Boolean);
    const [first, second] = parts;
    const initials = `${first?.[0] ?? ''}${second?.[0] ?? ''}`.toUpperCase();
    if (initials) return initials;
    return (first?.[0] ?? 'A').toUpperCase();
  }, [nome, nomeSocial]);

  const handleFileInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
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
    reader.onerror = () => {
      toast.error('Não foi possível carregar a foto.');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, []);

  const handlePickPhoto = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleEditPhoto = React.useCallback(() => {
    if (!fotoPreview) {
      handlePickPhoto();
      return;
    }
    setCropSource(fotoPreview);
    setCropOpen(true);
  }, [fotoPreview, handlePickPhoto]);

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
  function isCpfDigits(v: string) {
    return /^\d{11}$/.test(v);
  }
  function isTelDigits(v: string) {
    return /^(\d{10}|\d{11})$/.test(v);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!aluno) return;
    try {
      setSubmitting(true);
      const payload: Record<string, unknown> = {};
      if (nome.trim().length < 2) {
        toast.error('Nome muito curto');
        setSubmitting(false);
        return;
      }
      if (nome.trim() && nome.trim() !== aluno.nome) payload.nome = nome.trim();
      if ((nomeSocial || '') !== (aluno.nomeSocial || '')) payload.nomeSocial = nomeSocial || null;
      if (dataNasc) payload.dataNasc = new Date(dataNasc).toISOString();
      const cpfD = digits(cpf);
      if (cpfD && !isCpfDigits(cpfD)) {
        toast.error('CPF inválido');
        setSubmitting(false);
        return;
      }
      if (cpfD && cpfD !== (aluno.cpf || '')) payload.cpf = cpfD;
      if (email.trim()) {
        if (!isEmail(email.trim())) {
          toast.error('E-mail inválido');
          setSubmitting(false);
          return;
        }
      }
      if (email.trim() !== (aluno.email || ''))
        payload.email = email.trim() ? email.trim().toLowerCase() : undefined;
      const telDigits = digits(telefone);
      if (telDigits && !isTelDigits(telDigits)) {
        toast.error('Telefone inválido');
        setSubmitting(false);
        return;
      }
      if (telDigits !== (aluno.telefone || '')) payload.telefone = telDigits || undefined;
      if (foto) {
        if (foto !== (aluno.foto || '')) payload.foto = foto;
      } else if (fotoRemoved && (aluno.foto || '')) {
        payload.foto = null;
      }
      const end: Record<string, unknown> = {};
      const cepD = digits(cep);
      if (cepD && !isCepDigits(cepD)) {
        toast.error('CEP inválido');
        setSubmitting(false);
        return;
      }
      if ((cep || '') !== (aluno.enderecoCep || '')) end.cep = cepD;
      if ((logradouro || '') !== (aluno.enderecoLogradouro || '')) end.logradouro = logradouro;
      if ((numero || '') !== (aluno.enderecoNumero || '')) end.numero = numero;
      if ((complemento || '') !== (aluno.enderecoComplemento || '')) end.complemento = complemento;
      if ((bairro || '') !== (aluno.enderecoBairro || '')) end.bairro = bairro;
      if ((cidade || '') !== (aluno.enderecoCidade || '')) end.cidade = cidade;
      if (uf && !isUf(uf)) {
        toast.error('UF inválida');
        setSubmitting(false);
        return;
      }
      if ((uf || '') !== (aluno.enderecoUf || '')) end.uf = uf.toUpperCase();
      if (Object.keys(end).length > 0) payload.endereco = end;
      if ((observacao || '') !== (aluno.observacao || '')) payload.observacao = observacao || null;
      if ((genero || undefined) !== (aluno.genero || undefined))
        payload.genero = genero || undefined;
      if ((alergias || '') !== (aluno.alergias || '')) payload.alergias = alergias || null;
      if ((restricoes || '') !== (aluno.restricoesMedicas || ''))
        payload.restricoesMedicas = restricoes || null;
      if ((contatoNome || '') !== (aluno.contatoEmergenciaNome || ''))
        payload.contatoEmergenciaNome = contatoNome || null;
      const contatoTel = digits(contatoTelefone);
      if (contatoTel && !isTelDigits(contatoTel)) {
        toast.error('Telefone de emergência inválido');
        setSubmitting(false);
        return;
      }
      if (contatoTel !== (aluno.contatoEmergenciaTelefone || ''))
        payload.contatoEmergenciaTelefone = contatoTel || undefined;
      if (status !== aluno.status) payload.status = status;
      if ((codigoInterno || '') !== (aluno.codigoInterno || ''))
        payload.codigoInterno = codigoInterno || null;
      const resp: Record<string, unknown> = {};
      if (respNome.trim()) resp.nome = respNome.trim();
      const rcpf = digits(respCpf);
      if (rcpf && !isCpfDigits(rcpf)) {
        toast.error('CPF do responsável inválido');
        setSubmitting(false);
        return;
      }
      if (rcpf) resp.cpf = rcpf;
      if (respEmail.trim()) {
        if (!isEmail(respEmail.trim())) {
          toast.error('E-mail do responsável inválido');
          setSubmitting(false);
          return;
        }
        resp.email = respEmail.trim().toLowerCase();
      }
      const rtel = digits(respTelefone);
      if (rtel && !isTelDigits(rtel)) {
        toast.error('Telefone do responsável inválido');
        setSubmitting(false);
        return;
      }
      if (rtel) resp.telefone = rtel;
      const re: Record<string, unknown> = {};
      const rcep = digits(respCep);
      if (rcep && !isCepDigits(rcep)) {
        toast.error('CEP do responsável inválido');
        setSubmitting(false);
        return;
      }
      if (rcep) re.cep = rcep;
      if (respLogradouro) re.logradouro = respLogradouro;
      if (respNumero) re.numero = respNumero;
      if (respComplemento) re.complemento = respComplemento;
      if (respBairro) re.bairro = respBairro;
      if (respCidade) re.cidade = respCidade;
      if (respUf && !isUf(respUf)) {
        toast.error('UF do responsável inválida');
        setSubmitting(false);
        return;
      }
      if (respUf) re.uf = respUf.toUpperCase();
      if (Object.keys(re).length > 0) resp.endereco = re;
      if (Object.keys(resp).length > 0) payload.responsavel = resp;
      const res = await fetch(`/api/alunos/${aluno.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao atualizar' }));
        toast.error(data.error || 'Erro ao atualizar');
        return;
      }
      toast.success('Aluno atualizado');
      try {
        window.dispatchEvent(new CustomEvent('alunos:changed'));
      } catch {
        // Event dispatch is best effort; the saved state remains authoritative.
      }
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      logClientOperationalEvent('student.update.failed', error);
      toast.error('Erro de comunicação');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="edit-aluno-dialog"
        disableBackdropBlur
        overlayClass="alusa-registration-wizard-overlay"
        fullScreenMobile
        className="aluno-registration-wizard student-edit-dialog alusa-wizard-corner-smoothing [--wizard-field-background:#eff3f8] alusa-dark:[--wizard-field-background:var(--color-bg-elevated)] max-w-4xl w-full gap-0 overflow-hidden bg-[#f8fafc] p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
      >
        {aluno && (
          <form onSubmit={onSubmit} className="flex max-h-[88vh] min-h-0 flex-col max-md:max-h-none max-md:flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInputChange}
            />
            <div className="relative shrink-0 bg-[#f8fafc] px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-5">
              <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
                Editar aluno
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                Atualize os dados cadastrais, endereços e informações de emergência do aluno.
              </DialogDescription>
            </div>
            <div className="alusa-wizard-fields flex-1 space-y-4 overflow-y-auto scroll-smooth bg-[#f8fafc] px-4 py-4 max-md:min-h-0 alusa-dark:bg-transparent md:px-6 md:py-5">
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Foto</span>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex items-center justify-center">
                    <div className="relative h-28 w-28 overflow-hidden rounded-full border border-slate-200 bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                      {fotoPreview ? (
                        <img
                          src={fotoPreview}
                          alt={nome ? `Foto de ${nome}` : 'Foto do aluno'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
                          {avatarFallback}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                      A foto ajuda na identificação rápida do aluno em turmas, carteirinhas e
                      relatórios internos.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]"
                        onClick={handleEditPhoto}
                        disabled={!fotoPreview}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]"
                        onClick={handlePickPhoto}
                      >
                        {fotoPreview ? 'Substituir' : 'Enviar foto'}
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
                    <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                      Formatos suportados: JPG ou PNG até 5MB.
                    </p>
                  </div>
                </div>
              </div>
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Identificação</span>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
                  <div className="md:col-span-2 space-y-1">
                    <label htmlFor="student-edit-field-01" className={labelClass}>Nome</label>
                    <Input id="student-edit-field-01"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Nome completo"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-02" className={labelClass}>Nome social</label>
                    <Input id="student-edit-field-02"
                      value={nomeSocial}
                      onChange={(e) => setNomeSocial(e.target.value)}
                      placeholder="Opcional"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-03" className={labelClass}>Data de nascimento</label>
                    <Input id="student-edit-field-03"
                      type="date"
                      value={dataNasc}
                      onChange={(e) => setDataNasc(e.target.value)}
                      className={`${controlClass} student-edit-date-input`}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex h-4 items-center gap-1">
                      <label htmlFor="student-edit-field-04" className={labelClass}>CPF</label>
                      {aluno?.cpf && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="Por que o CPF não pode ser alterado?"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ca3af] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                              >
                                <InfoCircle aria-hidden="true" className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" align="center" className="max-w-xs text-left leading-relaxed">
                              CPF não pode ser alterado após cadastro.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <IMaskInput id="student-edit-field-04"
                      mask="000.000.000-00"
                      value={cpf}
                      onAccept={(v: unknown) => setCpf(String(v))}
                      className={controlClass}
                      placeholder="000.000.000-00"
                      disabled={Boolean(aluno?.cpf)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-05" className={labelClass}>E-mail</label>
                    <Input id="student-edit-field-05"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@exemplo.com"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-06" className={labelClass}>Telefone</label>
                    <IMaskInput id="student-edit-field-06"
                      mask={['(00) 0000-0000', '(00) 00000-0000']}
                      value={telefone}
                      onAccept={(v: unknown) => setTelefone(String(v))}
                      className={controlClass}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-07" className={labelClass}>Gênero</label>
                    <Select
                      value={genero || undefined}
                      onValueChange={(v) => setGenero(v as EditAluno['genero'])}
                    >
                      <SelectTrigger className={controlClass} id="student-edit-field-07">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent className="alusa-wizard-corner-smoothing">
                        <SelectItem value="MASCULINO">Masculino</SelectItem>
                        <SelectItem value="FEMININO">Feminino</SelectItem>
                        <SelectItem value="NAO_BINARIO">Não-binário</SelectItem>
                        <SelectItem value="OUTRO">Outro</SelectItem>
                        <SelectItem value="PREFERE_NAO_INFORMAR">Prefere não informar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-08" className={labelClass}>Status</label>
                    <Select value={status} onValueChange={(value) => setStatus(value as StatusAluno)}>
                      <SelectTrigger className={controlClass} id="student-edit-field-08">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className="alusa-wizard-corner-smoothing">
                        <SelectItem value="ATIVO">Ativo</SelectItem>
                        <SelectItem value="INATIVO">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-09" className={labelClass}>Código interno</label>
                    <Input id="student-edit-field-09"
                      value={codigoInterno}
                      onChange={(e) => setCodigoInterno(e.target.value)}
                      placeholder="00001"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <label htmlFor="student-edit-field-10" className={labelClass}>Customer ID</label>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="Sobre o Customer ID"
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ca3af] alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
                            >
                              <InfoCircle aria-hidden="true" className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="center" className="max-w-xs text-left leading-relaxed">
                            Identificador único no sistema de pagamentos.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input id="student-edit-field-10"
                      value={aluno?.asaasCustomerId || '—'}
                      disabled
                      readOnly
                      className={controlClass}
                    />
                  </div>
                </div>
              </div>
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Endereço do aluno</span>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-6">
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-11" className={labelClass}>CEP</label>
                    <IMaskInput id="student-edit-field-11"
                      mask="00000-000"
                      value={cep}
                      onAccept={(v: unknown) => setCep(String(v))}
                      className={controlClass}
                      placeholder="00000-000"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label htmlFor="student-edit-field-12" className={labelClass}>Logradouro</label>
                    <Input id="student-edit-field-12"
                      value={logradouro}
                      onChange={(e) => setLogradouro(e.target.value)}
                      placeholder="Rua/Av"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-13" className={labelClass}>Número</label>
                    <Input id="student-edit-field-13"
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      placeholder="Nº"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-14" className={labelClass}>Complemento</label>
                    <Input id="student-edit-field-14"
                      value={complemento}
                      onChange={(e) => setComplemento(e.target.value)}
                      placeholder="Opcional"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-15" className={labelClass}>Bairro</label>
                    <Input id="student-edit-field-15"
                      value={bairro}
                      onChange={(e) => setBairro(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label htmlFor="student-edit-field-16" className={labelClass}>Cidade</label>
                    <Input id="student-edit-field-16"
                      value={cidade}
                      onChange={(e) => setCidade(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-17" className={labelClass}>UF</label>
                    <Input id="student-edit-field-17"
                      value={uf}
                      onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="UF"
                      maxLength={2}
                      className={controlClass}
                    />
                  </div>
                </div>
              </div>
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Saúde e emergência</span>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
                  <div className="md:col-span-3 space-y-1">
                    <label htmlFor="student-edit-field-18" className={labelClass}>Observações</label>
                    <textarea id="student-edit-field-18"
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      rows={3}
                      className={textAreaClass}
                      placeholder="Notas gerais"
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <label htmlFor="student-edit-field-19" className={labelClass}>Alergias</label>
                    <textarea id="student-edit-field-19"
                      value={alergias}
                      onChange={(e) => setAlergias(e.target.value)}
                      rows={2}
                      className={textAreaClass}
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <label htmlFor="student-edit-field-20" className={labelClass}>Restrições médicas</label>
                    <textarea id="student-edit-field-20"
                      value={restricoes}
                      onChange={(e) => setRestricoes(e.target.value)}
                      rows={2}
                      className={textAreaClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-21" className={labelClass}>Contato emergência - nome</label>
                    <Input id="student-edit-field-21"
                      value={contatoNome}
                      onChange={(e) => setContatoNome(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-22" className={labelClass}>Contato emergência - telefone</label>
                    <IMaskInput id="student-edit-field-22"
                      mask={['(00) 0000-0000', '(00) 00000-0000']}
                      value={contatoTelefone}
                      onAccept={(v: unknown) => setContatoTelefone(String(v))}
                      className={controlClass}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
              </div>
              {aluno?.responsavel && (
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Responsável principal</span>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
                  <div className="md:col-span-2 space-y-1">
                    <label htmlFor="student-edit-field-23" className={labelClass}>Nome</label>
                    <Input id="student-edit-field-23"
                      value={respNome}
                      onChange={(e) => setRespNome(e.target.value)}
                      placeholder="Nome do responsável"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-24" className={labelClass}>CPF</label>
                    <IMaskInput id="student-edit-field-24"
                      mask="000.000.000-00"
                      value={respCpf}
                      onAccept={(v: unknown) => setRespCpf(String(v))}
                      className={controlClass}
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-25" className={labelClass}>E-mail</label>
                    <Input id="student-edit-field-25"
                      type="email"
                      value={respEmail}
                      onChange={(e) => setRespEmail(e.target.value)}
                      placeholder="email@exemplo.com"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-26" className={labelClass}>Telefone</label>
                    <IMaskInput id="student-edit-field-26"
                      mask={['(00) 0000-0000', '(00) 00000-0000']}
                      value={respTelefone}
                      onAccept={(v: unknown) => setRespTelefone(String(v))}
                      className={controlClass}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-6">
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-27" className={labelClass}>CEP</label>
                    <IMaskInput id="student-edit-field-27"
                      mask="00000-000"
                      value={respCep}
                      onAccept={(v: unknown) => setRespCep(String(v))}
                      className={controlClass}
                      placeholder="00000-000"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label htmlFor="student-edit-field-28" className={labelClass}>Logradouro</label>
                    <Input id="student-edit-field-28"
                      value={respLogradouro}
                      onChange={(e) => setRespLogradouro(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-29" className={labelClass}>Número</label>
                    <Input id="student-edit-field-29"
                      value={respNumero}
                      onChange={(e) => setRespNumero(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-30" className={labelClass}>Complemento</label>
                    <Input id="student-edit-field-30"
                      value={respComplemento}
                      onChange={(e) => setRespComplemento(e.target.value)}
                      placeholder="Opcional"
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-31" className={labelClass}>Bairro</label>
                    <Input id="student-edit-field-31"
                      value={respBairro}
                      onChange={(e) => setRespBairro(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label htmlFor="student-edit-field-32" className={labelClass}>Cidade</label>
                    <Input id="student-edit-field-32"
                      value={respCidade}
                      onChange={(e) => setRespCidade(e.target.value)}
                      className={controlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="student-edit-field-33" className={labelClass}>UF</label>
                    <Input id="student-edit-field-33"
                      value={respUf}
                      onChange={(e) => setRespUf(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="UF"
                      maxLength={2}
                      className={controlClass}
                    />
                  </div>
                </div>
              </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 bg-[#f8fafc] px-4 py-3 alusa-dark:bg-[color:var(--color-bg-card)] md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-3">
              <Button
                type="button"
                variant="outline"
                className="h-10 min-h-10 w-full min-w-0 rounded-[10px] border-0 bg-[#eff3f8] px-5 font-normal text-[#303030] shadow-none hover:bg-[#eff3f8] disabled:opacity-60 alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)] md:w-[120px]"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                variant="wizardPrimary"
                className="h-10 min-h-10 w-full min-w-0 rounded-[10px] bg-[#512a82] px-5 font-normal text-white shadow-none hover:bg-[#512a82] disabled:opacity-60 md:w-[120px]"
              >
                {submitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        )}
        <ImageCropDialog
          src={cropSource}
          open={cropOpen && Boolean(cropSource)}
          onOpenChange={(o) => {
            if (!o) handleCropClose();
            else setCropOpen(true);
          }}
          onApply={handleCropApply}
          aspect={1}
          title="Ajustar corte"
          round
          className="alusa-wizard-corner-smoothing"
        />
      </DialogContent>
    </Dialog>
  );
}

export default StudentEditDialog;

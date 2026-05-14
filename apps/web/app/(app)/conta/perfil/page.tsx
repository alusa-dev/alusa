'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  fetchCurrentProfile,
  updateCurrentProfile,
  type UpdateProfilePayload,
} from '@/features/account/services/profile-service';
import type { UserProfileWithSchool } from '@/features/account/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { pushToast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PROFILE_LOCALE_OPTIONS, PROFILE_THEME_OPTIONS } from '@/lib/profile-preferences';
import { BRAZIL_IANA_TIMEZONE_OPTIONS } from '@/lib/brazil-iana-timezones';
import { updateSchool, updateSchoolAddress, type SchoolAddress } from '@/features/account/services/profile-service';
import { EditActions } from '@/components/ui/edit-actions';
import { disabledInputClasses, formatCepBR, formatCpfCnpjBR, formatPhoneBR, isValidCepBR, isValidCpfCnpjBR, isValidPhoneBR, onlyDigits } from '@/lib/formatters';
import { ImageCropDialog } from '@/components/image/ImageCropDialog';
import { useUserStore } from '@/lib/stores/user-store';
import { Edit } from '@/components/icons/icons';

type FinanceOnboardingSnapshot = {
  financeProfile: {
    id: string;
    asaasAccountId: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
    isOnboardingCompleted: boolean;
    onboardingCompletedAt: string | null;
    lastAsaasSyncAt: string | null;
    mobilePhone: string | null;
    incomeValue: number | null;
    address: string | null;
    addressNumber: string | null;
    province: string | null;
    postalCode: string | null;
    complement: string | null;
    asaasOwnerName?: string | null;
    asaasCompanyName?: string | null;
    asaasLoginEmail?: string | null;
    asaasName?: string | null;
    asaasPhone?: string | null;
    asaasSite?: string | null;
    updatedAt: string;
    createdAt: string;
  } | null;
  financialAccount: {
    commercialInfo: {
      status?: string;
      personType?: string;
      cpfCnpj?: string;
      name?: string;
      birthDate?: string;
      companyName?: string | null;
      availableCompanyNames?: string[];
      companyType?: string;
      incomeValue?: number;
      email?: string;
      phone?: string | null;
      mobilePhone?: string | null;
      postalCode?: string;
      address?: string;
      addressNumber?: string;
      complement?: string | null;
      province?: string;
      city?: { name?: string; state?: string } | null;
      site?: string | null;
      tradingName?: string | null;
      commercialInfoExpiration?: { isExpired?: boolean; scheduledDate?: string } | null;
    } | null;
    commercialInfoStatus?: string | null;
    commercialInfoScheduledDate?: string | null;
    myAccountStatus: {
      commercialInfo?: string;
      bankAccountInfo?: string;
      documentation?: string;
      general?: string;
    } | null;
    documents: {
      data: Array<{
        id: string;
        status: string;
        title?: string;
        description?: string;
        onboardingUrl?: string;
        onboardingUrlExpirationDate?: string;
      }>;
    } | null;
    documentsNotReady: boolean;
    retryAfterMs: number | null;
  };
};

const profileSurfaceClassName =
  'space-y-6 rounded-lg bg-white p-6 alusa-dark:bg-transparent md:p-8';

const profileCardClassName =
  'rounded-xl border border-gray-200 bg-white shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]';

const profileCardHeaderClassName =
  'border-b border-gray-100 px-6 py-5 alusa-dark:border-[color:var(--color-border-subtle)]';

const profileCardTitleClassName =
  'text-xl font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]';

const profileCardDescriptionClassName =
  'mt-1 text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]';

const profileEditingCardClassName =
  'border-indigo-400 shadow-indigo-100 ring-2 ring-indigo-100 alusa-dark:border-[color:var(--color-border-brand)] alusa-dark:shadow-none alusa-dark:ring-[color:rgba(148,146,209,0.16)]';

const profileEditingBadgeClassName =
  'flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-indigo-700 alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-brand-300)]';

export default function ContaPerfilPage() {
  const [profile, setProfile] = useState<UserProfileWithSchool | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [financeSnapshot, setFinanceSnapshot] = useState<FinanceOnboardingSnapshot | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);

  // Edição - Dados financeiros (inline)
  const [isEditingFinance, setIsEditingFinance] = useState(false);
  const [isSavingFinance, setIsSavingFinance] = useState(false);

  type FinanceFormState = {
    email: string;
    phone: string;
    site: string;
    mobilePhone: string;
    incomeValue: string;
    address: string;
    addressNumber: string;
    province: string;
    postalCode: string;
    complement: string;
  };

  const [financeForm, setFinanceForm] = useState<FinanceFormState>({
    email: '',
    phone: '',
    site: '',
    mobilePhone: '',
    incomeValue: '',
    address: '',
    addressNumber: '',
    province: '',
    postalCode: '',
    complement: '',
  });

  const [financeFormInitial, setFinanceFormInitial] = useState<FinanceFormState>({
    email: '',
    phone: '',
    site: '',
    mobilePhone: '',
    incomeValue: '',
    address: '',
    addressNumber: '',
    province: '',
    postalCode: '',
    complement: '',
  });

  // Edição - Dados pessoais
  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);

  // Edição - Preferências
  const [isEditingPrefs, setIsEditingPrefs] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);

  // Form fields - pessoais
  const [formName, setFormName] = useState('');
  const [formTelefone, setFormTelefone] = useState('');
  const [formBio, setFormBio] = useState('');

  // Form fields - preferências
  const [formLocale, setFormLocale] = useState('pt-BR');
  const [formTheme, setFormTheme] = useState('system');

  // Foto de perfil
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Crop de imagem
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);

  // User store para atualizar avatar globalmente
  const updateUser = useUserStore((state) => state.updateUser);

  // Escola (Conta)
  const [isEditingSchool, setIsEditingSchool] = useState(false);
  const [isSavingSchool, setIsSavingSchool] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [schoolCpfCnpj, setSchoolCpfCnpj] = useState('');
  const [schoolTimezone, setSchoolTimezone] = useState('America/Sao_Paulo');

  // Endereço da escola
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [schoolAddress, setSchoolAddress] = useState<SchoolAddress>({ street: '', number: '', district: '', city: '', state: '', cep: '' });

  useEffect(() => {
    let mounted = true;
    fetchCurrentProfile()
      .then((data) => {
        if (!mounted) return;
        setProfile(data);
        setLoading(false);
        // Inicializa formulários
        setFormName(data.name ?? '');
        setFormTelefone(data.telefone ? formatPhoneBR(data.telefone) : '');
        setFormBio(data.bio ?? '');
        setFormLocale(data.locale ?? 'pt-BR');
        setFormTheme(data.theme ?? 'system');
        setSchoolName(data.school?.name ?? '');
        setSchoolCpfCnpj(data.school?.cpfCnpj ?? '');
        setSchoolTimezone(data.school?.timezone ?? 'America/Sao_Paulo');
        if (data.school?.address) {
          setSchoolAddress({
            street: data.school.address.street || '',
            number: data.school.address.number || '',
            district: data.school.address.district || '',
            city: data.school.address.city || '',
            state: data.school.address.state || '',
            cep: data.school.address.cep || '',
          });
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (profile.role?.toUpperCase() !== 'ADMIN') return;

    let mounted = true;
    setFinanceLoading(true);
    setFinanceError(null);

    fetch('/api/conta/finance-onboarding', { method: 'GET' })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { data?: FinanceOnboardingSnapshot; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || 'Erro ao carregar dados financeiros');
        return json?.data ?? null;
      })
      .then((data) => {
        if (!mounted) return;
        setFinanceSnapshot(data);
      })
      .catch((err) => {
        if (!mounted) return;
        setFinanceError(err instanceof Error ? err.message : 'Erro ao carregar dados financeiros');
      })
      .finally(() => {
        if (!mounted) return;
        setFinanceLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [profile]);

  const reloadFinanceSnapshot = useCallback(async () => {
    const res = await fetch('/api/conta/finance-onboarding', { method: 'GET', cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as { data?: FinanceOnboardingSnapshot; error?: string } | null;
    if (!res.ok) throw new Error(json?.error || 'Erro ao carregar dados financeiros');
    setFinanceSnapshot(json?.data ?? null);
  }, []);

  const formatCurrencyBRL = useCallback((value: number | null | undefined) => {
    if (value == null) return '-';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }, []);

  const formatCommercialInfoDate = useCallback((value: string | null | undefined): string | null => {
    if (!value) return null;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('pt-BR');
  }, []);

  const parseCurrencyBRL = useCallback((input: string): number => {
    const raw = String(input ?? '').trim();
    if (!raw) return Number.NaN;
    const normalized = raw
      .replace(/\s/g, '')
      .replace(/R\$/gi, '')
      .replace(/\./g, '')
      .replace(',', '.');
    return Number(normalized);
  }, []);

  const formatCurrencyInputBRL = useCallback((value: number | null | undefined): string => {
    if (value == null) return '';
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, []);

  useEffect(() => {
    if (!financeSnapshot) return;
    if (isEditingFinance) return;

    const profileData = financeSnapshot.financeProfile;
    const commercialInfo = financeSnapshot.financialAccount?.commercialInfo;

    const next: FinanceFormState = {
      email: (profile?.email ?? '').trim(),
      phone: formatPhoneBR(commercialInfo?.phone ?? profileData?.asaasPhone ?? ''),
      site: (commercialInfo?.site ?? profileData?.asaasSite ?? '').trim(),
      mobilePhone: formatPhoneBR(commercialInfo?.mobilePhone ?? profileData?.mobilePhone ?? ''),
      incomeValue: formatCurrencyInputBRL(commercialInfo?.incomeValue ?? profileData?.incomeValue ?? null),
      address: (commercialInfo?.address ?? profileData?.address ?? '').trim(),
      addressNumber: (commercialInfo?.addressNumber ?? profileData?.addressNumber ?? '').trim(),
      province: (commercialInfo?.province ?? profileData?.province ?? '').trim(),
      postalCode: onlyDigits(commercialInfo?.postalCode ?? profileData?.postalCode ?? ''),
      complement: (commercialInfo?.complement ?? profileData?.complement ?? '').trim(),
    };

    setFinanceForm(next);
    setFinanceFormInitial(next);
  }, [financeSnapshot, formatCurrencyInputBRL, isEditingFinance, profile?.email]);

  const financeDirty = useCallback(() => {
    return (
      onlyDigits(financeForm.phone) !== onlyDigits(financeFormInitial.phone) ||
      financeForm.site.trim() !== financeFormInitial.site.trim() ||
      onlyDigits(financeForm.mobilePhone) !== onlyDigits(financeFormInitial.mobilePhone) ||
      financeForm.incomeValue.trim() !== financeFormInitial.incomeValue.trim() ||
      financeForm.address.trim() !== financeFormInitial.address.trim() ||
      financeForm.addressNumber.trim() !== financeFormInitial.addressNumber.trim() ||
      financeForm.province.trim() !== financeFormInitial.province.trim() ||
      onlyDigits(financeForm.postalCode) !== onlyDigits(financeFormInitial.postalCode) ||
      financeForm.complement.trim() !== financeFormInitial.complement.trim()
    );
  }, [financeForm, financeFormInitial]);

  const financeSaveDisabled = useCallback(() => {
    if (!financeDirty()) return true;
    if (!financeForm.address.trim()) return true;
    if (!financeForm.addressNumber.trim()) return true;
    if (!financeForm.province.trim()) return true;
    if (!isValidPhoneBR(financeForm.mobilePhone)) return true;
    if (financeForm.phone.trim() && !isValidPhoneBR(financeForm.phone)) return true;
    if (!isValidCepBR(financeForm.postalCode)) return true;

    const income = parseCurrencyBRL(financeForm.incomeValue);
    if (!Number.isFinite(income) || income <= 0) return true;

    return false;
  }, [financeDirty, financeForm, parseCurrencyBRL]);

  const commercialInfoStatus = financeSnapshot?.financialAccount?.commercialInfoStatus ?? null;
  const commercialInfoStatusValue = (commercialInfoStatus ?? '').toUpperCase();
  const commercialInfoExpiration = financeSnapshot?.financialAccount?.commercialInfo?.commercialInfoExpiration ?? null;
  const scheduledDateFallback = financeSnapshot?.financialAccount?.commercialInfoScheduledDate ?? null;
  const commercialInfoScheduledDate = formatCommercialInfoDate(
    commercialInfoExpiration?.scheduledDate ?? scheduledDateFallback ?? undefined,
  );

  const saveFinanceInline = useCallback(async () => {
    try {
      setIsSavingFinance(true);

      const income = parseCurrencyBRL(financeForm.incomeValue);
      const commercialInfo = financeSnapshot?.financialAccount?.commercialInfo ?? null;

      if (!commercialInfo?.cpfCnpj || !commercialInfo?.personType) {
        pushToast({
          title: 'Dados incompletos',
          description: 'Não foi possível identificar os dados cadastrais. Atualize pelo onboarding completo.',
          variant: 'warning',
        });
        return;
      }

      const personTypeRaw = commercialInfo.personType?.toUpperCase();
      const personType = personTypeRaw === 'JURIDICA' || personTypeRaw === 'PJ' ? 'PJ' : 'PF';
      const ownerName = commercialInfo.name ?? null;
      const companyName = personType === 'PJ' ? commercialInfo.companyName ?? null : null;

      if (!ownerName) {
        pushToast({
          title: 'Dados incompletos',
          description: 'Nome do responsável não encontrado. Atualize pelo onboarding completo.',
          variant: 'warning',
        });
        return;
      }

      if (personType === 'PJ' && !companyName) {
        pushToast({
          title: 'Dados incompletos',
          description: 'Razão social não encontrada. Atualize pelo onboarding completo.',
          variant: 'warning',
        });
        return;
      }

      if (personType === 'PF' && !commercialInfo.birthDate) {
        pushToast({
          title: 'Dados incompletos',
          description: 'Data de nascimento não encontrada. Atualize pelo onboarding completo.',
          variant: 'warning',
        });
        return;
      }

      if (personType === 'PJ' && !commercialInfo.companyType) {
        pushToast({
          title: 'Dados incompletos',
          description: 'Tipo da empresa não encontrado. Atualize pelo onboarding completo.',
          variant: 'warning',
        });
        return;
      }

      const payload = {
        personType,
        ownerName,
        companyName: personType === 'PJ' ? companyName ?? undefined : undefined,
        cpfCnpj: onlyDigits(commercialInfo.cpfCnpj),
        birthDate: personType === 'PF' ? commercialInfo.birthDate ?? undefined : undefined,
        companyType: personType === 'PJ' ? commercialInfo.companyType ?? undefined : undefined,
        phone: onlyDigits(financeForm.phone) || undefined,
        site: financeForm.site.trim() ? financeForm.site.trim() : undefined,
        mobilePhone: onlyDigits(financeForm.mobilePhone),
        incomeValue: income,
        address: financeForm.address.trim(),
        addressNumber: financeForm.addressNumber.trim(),
        province: financeForm.province.trim(),
        postalCode: onlyDigits(financeForm.postalCode).slice(0, 8),
        complement: financeForm.complement.trim() ? financeForm.complement.trim() : undefined,
      };

      const res = await fetch('/api/kyc/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
        const rawMessage =
          typeof json?.message === 'string'
            ? json.message
            : typeof json?.error === 'string'
              ? json.error
              : 'Não foi possível salvar os dados.';

        const message = rawMessage.toLowerCase().includes('asaas')
          ? 'Não foi possível salvar os dados agora. Tente novamente.'
          : rawMessage;

        pushToast({ title: 'Erro', description: message, variant: 'error' });
        return;
      }

      pushToast({ title: 'Sucesso', description: 'Dados financeiros atualizados.', variant: 'success' });
      setIsEditingFinance(false);

      await reloadFinanceSnapshot();
    } catch (err) {
      pushToast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível salvar os dados.',
        variant: 'error',
      });
    } finally {
      setIsSavingFinance(false);
    }
  }, [financeForm, financeSnapshot?.financialAccount?.commercialInfo, parseCurrencyBRL, reloadFinanceSnapshot]);

  // Handler para selecionar arquivo e abrir crop
  const handleFileSelect = useCallback((file: File) => {
    console.log('📸 handleFileSelect chamado com arquivo:', file.name, file.type, file.size);
    
    if (!file.type.startsWith('image/')) {
      console.error('❌ Tipo de arquivo inválido:', file.type);
      pushToast({ title: 'Erro', description: 'Selecione uma imagem válida (JPG, PNG ou WebP)', variant: 'error' });
      return;
    }

    const MAX_SIZE = 15 * 1024 * 1024; // 15MB
    if (file.size > MAX_SIZE) {
      console.error('❌ Arquivo muito grande:', file.size);
      pushToast({ title: 'Erro', description: 'A imagem deve ter no máximo 15MB', variant: 'error' });
      return;
    }

    console.log('✅ Arquivo válido, iniciando leitura...');
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      console.log('✅ Arquivo carregado, tamanho do data URL:', typeof result === 'string' ? result.length : 0);
      if (typeof result === 'string') {
        setImageToCrop(result);
        setCropDialogOpen(true);
        console.log('✅ Dialog de crop aberto!');
      }
    };
    reader.onerror = (error) => {
      console.error('❌ Erro ao ler arquivo:', error);
      pushToast({ title: 'Erro', description: 'Não foi possível carregar a imagem', variant: 'error' });
    };
    reader.readAsDataURL(file);
  }, []);

  // Handler após aplicar crop
  const handleCropApply = useCallback(async (result: { blob: Blob; dataUrl: string }) => {
    console.log('🎨 handleCropApply chamado!', {
      hasProfile: !!profile,
      blobSize: result.blob.size,
      dataUrlLength: result.dataUrl.length
    });
    
    if (!profile) {
      console.error('❌ Profile não disponível');
      return;
    }
    
    setIsUploadingPhoto(true);
    setPhotoPreview(result.dataUrl);
    setCropDialogOpen(false);
    console.log('📤 Iniciando upload...');
    
    try {
      const form = new FormData();
      form.append('file', result.blob, 'profile.jpg');
      console.log('📤 Enviando para /api/upload...');
      
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const json = await res.json();
      console.log('📥 Resposta do upload:', { ok: res.ok, status: res.status, json });
      
      if (!res.ok) throw new Error(json?.error || 'Falha no upload');

      console.log('✅ Upload bem-sucedido! URL:', json.url);
      console.log('📝 Atualizando perfil APENAS com foto...');

      // Atualizar APENAS a foto via API diretamente
      const res2 = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto: json.url }),
      });

      if (!res2.ok) {
        const errorJson = await res2.json();
        console.error('❌ Erro ao atualizar foto no perfil:', errorJson);
        throw new Error(errorJson?.error || 'Falha ao atualizar foto no perfil');
      }

      const updated = await res2.json();
      console.log('✅ Resposta da API:', updated);
      
      console.log('✅ Perfil atualizado!', updated);
      setProfile((prev) => (prev ? { ...prev, ...updated } : updated as UserProfileWithSchool));

      // Atualizar store global e disparar evento para atualizar header/sidebar
      try {
        console.log('🔄 Atualizando store global...');
        updateUser({ foto: json.url });
        window.dispatchEvent(new CustomEvent('user:updated', { 
          detail: { foto: json.url } 
        }));
        console.log('✅ Store atualizada e evento disparado!');
      } catch (storeError) {
        console.error('⚠️ Erro ao atualizar store (não-crítico):', storeError);
      }

      pushToast({ title: 'Sucesso', description: 'Foto atualizada com sucesso!' });
    } catch (e) {
      console.error('❌ Erro no handleCropApply:', e);
      const message = e instanceof Error ? e.message : 'Falha ao enviar foto';
      pushToast({ title: 'Erro', description: message, variant: 'error' });
    } finally {
      setIsUploadingPhoto(false);
      setPhotoPreview(null);
      setImageToCrop(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      console.log('🏁 handleCropApply finalizado');
    }
  }, [profile, updateUser]);

  const handleRemovePhoto = useCallback(async () => {
    if (!profile) return;
    setIsUploadingPhoto(true);
    try {
      // Atualizar APENAS a foto via API diretamente
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto: null }),
      });

      if (!res.ok) {
        const errorJson = await res.json();
        throw new Error(errorJson?.error || 'Falha ao remover foto');
      }

      const updated = await res.json();
      setProfile((prev) => (prev ? { ...prev, ...updated } : updated as UserProfileWithSchool));

      // Atualizar store global e disparar evento para atualizar header/sidebar
      try {
        updateUser({ foto: null });
        window.dispatchEvent(new CustomEvent('user:updated', { 
          detail: { foto: null } 
        }));
      } catch {
        // Ignore errors - não é crítico
      }

      pushToast({ title: 'Sucesso', description: 'Foto removida com sucesso!' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao remover foto';
      pushToast({ title: 'Erro', description: message, variant: 'error' });
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [profile, updateUser]);

  // Loading state
  if (loading) {
    return (
      <section className="space-y-6 pb-8">
        <header>
          <div className="h-7 w-56"><Skeleton className="h-7 w-56" /></div>
        </header>
        <Card className={profileCardClassName}>
          <CardHeader className="pb-2">
            <div className="space-y-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </CardContent>
        </Card>
        {[1, 2, 3].map((i) => (
          <Card key={i} className={profileCardClassName}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-center">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-8 w-20" />
              </div>
              <Skeleton className="h-3 w-64 mt-1" />
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        ))}
      </section>
    );
  }

  // Error state
  if (error || !profile) {
    return (
      <section className="space-y-6">
        <div className="text-sm text-destructive">{error || 'Erro ao carregar perfil.'}</div>
      </section>
    );
  }

  async function handleSavePersonal() {
    if (!profile) return;
    setIsSavingPersonal(true);
    try {
      // Garantir valores válidos para locale e theme
      const validLocale = (profile.locale === 'pt-BR' || profile.locale === 'en-US') ? profile.locale : 'pt-BR';
      const validTheme = (profile.theme === 'system' || profile.theme === 'light' || profile.theme === 'dark') ? profile.theme : 'system';

      const payload: UpdateProfilePayload = {
        name: formName,
        telefone: formTelefone,
        bio: formBio,
        locale: validLocale as UpdateProfilePayload['locale'],
        theme: validTheme as UpdateProfilePayload['theme'],
      };
      const updated = await updateCurrentProfile(payload);
      setProfile((prev) => (prev ? { ...prev, ...updated } : ({ ...updated, school: profile.school } as UserProfileWithSchool)));
      pushToast({ title: 'Sucesso', description: 'Perfil atualizado.' });
      setIsEditingPersonal(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao salvar';
      pushToast({ title: 'Erro', description: message, variant: 'error' });
    } finally {
      setIsSavingPersonal(false);
    }
  }

  async function handleSavePrefs() {
    if (!profile) return;
    setIsSavingPrefs(true);
    try {
      const payload: UpdateProfilePayload = {
        name: profile.name,
        telefone: profile.telefone ?? undefined,
        bio: profile.bio ?? undefined,
        locale: formLocale as UpdateProfilePayload['locale'],
        theme: formTheme as UpdateProfilePayload['theme'],
      };
      const updated = await updateCurrentProfile(payload);
      setProfile((prev) => (prev ? { ...prev, ...updated } : ({ ...updated, school: profile.school } as UserProfileWithSchool)));
      pushToast({ title: 'Sucesso', description: 'Preferências atualizadas.' });
      setIsEditingPrefs(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao salvar';
      pushToast({ title: 'Erro', description: message, variant: 'error' });
    } finally {
      setIsSavingPrefs(false);
    }
  }

  async function handleSaveSchool() {
    setIsSavingSchool(true);
    try {
      const updated = await updateSchool({
        name: schoolName,
        cpfCnpj: schoolCpfCnpj,
        timezone: schoolTimezone,
      });
      setProfile((prev) => (prev ? { ...prev, school: { ...prev.school, ...updated } as UserProfileWithSchool['school'] } : prev));
      pushToast({ title: 'Sucesso', description: 'Dados da escola atualizados.' });
      setIsEditingSchool(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao salvar';
      pushToast({ title: 'Erro', description: message, variant: 'error' });
    } finally {
      setIsSavingSchool(false);
    }
  }

  async function handleSaveAddress() {
    setIsSavingAddress(true);
    try {
      const updated = await updateSchoolAddress(schoolAddress);
      setSchoolAddress(updated);
      pushToast({ title: 'Sucesso', description: 'Endereço atualizado.' });
      setIsEditingAddress(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao salvar';
      pushToast({ title: 'Erro', description: message, variant: 'error' });
    } finally {
      setIsSavingAddress(false);
    }
  }

  const personalDirty =
    formName.trim() !== (profile.name ?? '') ||
    onlyDigits(formTelefone) !== onlyDigits(profile.telefone ?? '') ||
    (formBio ?? '') !== (profile.bio ?? '');

  const prefsDirty = formLocale !== profile.locale || formTheme !== profile.theme;
  const canEditSchoolProfile = profile.role?.toUpperCase() === 'ADMIN';

  const schoolDirty =
    schoolName.trim() !== (profile.school?.name ?? '') ||
    onlyDigits(schoolCpfCnpj) !== onlyDigits(profile.school?.cpfCnpj ?? '') ||
    schoolTimezone !== (profile.school?.timezone ?? 'America/Sao_Paulo');

  const addr: SchoolAddress = profile.school?.address ?? {
    street: '',
    number: '',
    district: '',
    city: '',
    state: '',
    cep: '',
  };
  const addressDirty =
    (schoolAddress.street || '') !== (addr.street || '') ||
    (schoolAddress.number || '') !== (addr.number || '') ||
    (schoolAddress.district || '') !== (addr.district || '') ||
    (schoolAddress.city || '') !== (addr.city || '') ||
    (schoolAddress.state || '') !== (addr.state || '') ||
    onlyDigits(schoolAddress.cep || '') !== onlyDigits(addr.cep || '');

  return (
    <section
      aria-labelledby="perfil-title"
      className={profileSurfaceClassName}
    >
      <header className="space-y-1">
        <h2
          id="perfil-title"
          className="text-xl font-medium tracking-tight text-gray-900 alusa-dark:text-[color:var(--color-text-primary)] md:text-2xl"
        >
          Altere seus dados
        </h2>
        <p className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
          Atualize sua foto de perfil, dados pessoais e informações da escola.
        </p>
      </header>

      {/* Foto do perfil */}
      <Card className={profileCardClassName}>
        <CardHeader className={profileCardHeaderClassName}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={profileCardTitleClassName}>Foto do perfil</CardTitle>
              <CardDescription className={profileCardDescriptionClassName}>
                Personalize sua foto de perfil. Recomendamos uma imagem quadrada de alta qualidade.
              </CardDescription>
            </div>
            {isUploadingPhoto && (
              <div className={profileEditingBadgeClassName}>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-700" />
                <span className="text-sm font-medium">Enviando...</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6">
          <div className="flex items-start gap-6">
            <div className="relative group">
              <Avatar className="h-24 w-24 border-2 border-gray-200 shadow-sm alusa-dark:border-[color:var(--color-border-default)]">
                <AvatarImage 
                  src={photoPreview ?? profile.foto ?? undefined} 
                  alt={profile.name}
                  className="object-cover"
                />
                <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-2xl font-semibold">
                  {profile.name?.[0]?.toUpperCase() ?? 'U'}
                </AvatarFallback>
              </Avatar>
              {isUploadingPhoto && (
                <div className="absolute inset-0 grid place-items-center rounded-full bg-white/80 backdrop-blur-sm alusa-dark:bg-[color:rgba(18,19,26,0.78)]">
                  <div className="h-8 w-8 rounded-full border-3 border-violet-300 border-t-violet-600 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <div className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                <p className="mb-1 font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Requisitos da imagem:</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                  <li>Formatos aceitos: JPG, PNG ou WebP</li>
                  <li>Tamanho máximo: 15MB</li>
                  <li>Recomendado: imagem quadrada com pelo menos 512x512px</li>
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/jpg"
                  className="sr-only"
                  aria-label="Selecionar foto de perfil"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = '';
                  }}
                />
                <Button 
                  size="sm" 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={isUploadingPhoto}
                  className="bg-violet-600 text-white hover:bg-violet-700"
                >
                  {isUploadingPhoto ? 'Processando...' : profile.foto ? 'Alterar foto' : 'Adicionar foto'}
                </Button>
                {profile.foto && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleRemovePhoto} 
                    disabled={isUploadingPhoto}
                    className="border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 alusa-dark:border-red-900/50 alusa-dark:text-red-300 alusa-dark:hover:border-red-800 alusa-dark:hover:bg-red-950/30"
                  >
                    Remover foto
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1. Dados pessoais */}
      <Card className={`${profileCardClassName} transition-all duration-200 ${
        isEditingPersonal
          ? profileEditingCardClassName
          : ''
      }`}>
        <CardHeader className={profileCardHeaderClassName}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={profileCardTitleClassName}>Dados pessoais</CardTitle>
              <CardDescription className={profileCardDescriptionClassName}>
                Informações básicas e de contato do usuário
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isEditingPersonal && (
                <div className={profileEditingBadgeClassName}>
                  <Edit className="h-4 w-4" />
                  <span className="text-sm font-medium">Modo de edição</span>
                </div>
              )}
              <EditActions
                isEditing={isEditingPersonal}
                isSaving={isSavingPersonal}
                onEdit={() => {
                  setIsEditingPersonal(true);
                  setTimeout(() => nameInputRef.current?.focus(), 0);
                }}
                onCancel={() => {
                  setFormName(profile.name ?? '');
                  setFormTelefone(profile.telefone ? formatPhoneBR(profile.telefone) : '');
                  setFormBio(profile.bio ?? '');
                  setIsEditingPersonal(false);
                }}
                onSave={handleSavePersonal}
                saveDisabled={!personalDirty || (formTelefone.length > 0 && !isValidPhoneBR(formTelefone))}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6 grid gap-4 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-4 sm:col-span-2">
            <div>
              <Label className="text-xs text-muted-foreground">Nome</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={!isEditingPersonal}
                ref={nameInputRef}
                className={disabledInputClasses(!isEditingPersonal)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">E-mail</Label>
              <Input
                value={profile.email}
                disabled
                className={disabledInputClasses(true)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Telefone</Label>
              <Input
                value={formTelefone}
                onChange={(e) => setFormTelefone(formatPhoneBR(e.target.value))}
                placeholder="(00) 00000-0000"
                disabled={!isEditingPersonal}
                className={disabledInputClasses(!isEditingPersonal)}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Bio</Label>
              <Textarea
                value={formBio}
                onChange={(e) => setFormBio(e.target.value)}
                rows={3}
                disabled={!isEditingPersonal}
                className={disabledInputClasses(!isEditingPersonal)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Dados da escola */}
      <Card className={`${profileCardClassName} transition-all duration-200 ${
        isEditingSchool
          ? profileEditingCardClassName
          : ''
      }`}>
        <CardHeader className={profileCardHeaderClassName}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={profileCardTitleClassName}>Dados da escola</CardTitle>
              <CardDescription className={profileCardDescriptionClassName}>
                Informações da instituição vinculada à sua conta
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isEditingSchool && (
                <div className={profileEditingBadgeClassName}>
                  <Edit className="h-4 w-4" />
                  <span className="text-sm font-medium">Modo de edição</span>
                </div>
              )}
              {canEditSchoolProfile ? (
                <EditActions
                  isEditing={isEditingSchool}
                  isSaving={isSavingSchool}
                  onEdit={() => setIsEditingSchool(true)}
                  onCancel={() => {
                    setSchoolName(profile.school?.name || '');
                    setSchoolCpfCnpj(profile.school?.cpfCnpj || '');
                    setSchoolTimezone(profile.school?.timezone ?? 'America/Sao_Paulo');
                    setIsEditingSchool(false);
                  }}
                  onSave={handleSaveSchool}
                  saveDisabled={!schoolDirty || (schoolCpfCnpj ? !isValidCpfCnpjBR(schoolCpfCnpj) : false)}
                />
              ) : (
                <span className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Somente admins podem editar</span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6 grid gap-2 sm:grid-cols-1">
          <div>
            <Label className="text-xs text-muted-foreground">Nome da escola</Label>
            <Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} disabled={!isEditingSchool} className={disabledInputClasses(!isEditingSchool)} />
            <Label className="text-xs text-muted-foreground mt-2">CNPJ/CPF</Label>
            <Input value={formatCpfCnpjBR(schoolCpfCnpj)} onChange={(e) => setSchoolCpfCnpj(onlyDigits(e.target.value))} disabled={!isEditingSchool} className={disabledInputClasses(!isEditingSchool)} />
            <Label className="text-xs text-muted-foreground mt-2">Fuso horário da escola</Label>
            <Select value={schoolTimezone} onValueChange={setSchoolTimezone} disabled={!isEditingSchool}>
              <SelectTrigger className={disabledInputClasses(!isEditingSchool)}>
                <SelectValue placeholder="Selecione o fuso" />
              </SelectTrigger>
              <SelectContent>
                {BRAZIL_IANA_TIMEZONE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Usado para gerar horários da agenda e das turmas. Após alterar, reconstrua a agenda em Aulas se os horários
              recorrentes estiverem defasados.
            </p>
            <Label className="text-xs text-muted-foreground mt-2">Status</Label>
            <Input
              value={profile.school?.status || 'Não informado'}
              disabled
              className={disabledInputClasses(true)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 3. Endereço */}
      <Card className={`${profileCardClassName} transition-all duration-200 ${
        isEditingAddress
          ? profileEditingCardClassName
          : ''
      }`}>
        <CardHeader className={profileCardHeaderClassName}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={profileCardTitleClassName}>Endereço da escola</CardTitle>
              <CardDescription className={profileCardDescriptionClassName}>
                Localização física da instituição
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isEditingAddress && (
                <div className={profileEditingBadgeClassName}>
                  <Edit className="h-4 w-4" />
                  <span className="text-sm font-medium">Modo de edição</span>
                </div>
              )}
              {canEditSchoolProfile ? (
                <EditActions
                  isEditing={isEditingAddress}
                  isSaving={isSavingAddress}
                  onEdit={() => setIsEditingAddress(true)}
                  onCancel={() => {
                    const a: SchoolAddress = profile.school?.address || {
                      street: '',
                      number: '',
                      district: '',
                      city: '',
                      state: '',
                      cep: '',
                    };
                    setSchoolAddress({
                      street: a.street || '',
                      number: a.number || '',
                      district: a.district || '',
                      city: a.city || '',
                      state: a.state || '',
                      cep: a.cep || '',
                    });
                    setIsEditingAddress(false);
                  }}
                  onSave={async () => {
                    await handleSaveAddress();
                    // sync back into profile for dirty check
                    setProfile((prev) =>
                      prev
                        ? {
                            ...prev,
                            school: prev.school
                              ? {
                                  ...prev.school,
                                  address: { ...schoolAddress },
                                }
                              : prev.school,
                          }
                        : prev,
                    );
                  }}
                  saveDisabled={!addressDirty || (schoolAddress.cep ? !isValidCepBR(schoolAddress.cep) : false)}
                />
              ) : (
                <span className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Somente admins podem editar</span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6 grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Rua</Label>
            <Input value={schoolAddress.street || ''} onChange={(e) => setSchoolAddress({ ...schoolAddress, street: e.target.value })} disabled={!isEditingAddress} className={disabledInputClasses(!isEditingAddress)} />
            <Label className="text-xs text-muted-foreground mt-2">Número</Label>
            <Input value={schoolAddress.number || ''} onChange={(e) => setSchoolAddress({ ...schoolAddress, number: e.target.value })} disabled={!isEditingAddress} className={disabledInputClasses(!isEditingAddress)} />
            <Label className="text-xs text-muted-foreground mt-2">Bairro</Label>
            <Input value={schoolAddress.district || ''} onChange={(e) => setSchoolAddress({ ...schoolAddress, district: e.target.value })} disabled={!isEditingAddress} className={disabledInputClasses(!isEditingAddress)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Cidade</Label>
            <Input value={schoolAddress.city || ''} onChange={(e) => setSchoolAddress({ ...schoolAddress, city: e.target.value })} disabled={!isEditingAddress} className={disabledInputClasses(!isEditingAddress)} />
            <Label className="text-xs text-muted-foreground mt-2">Estado</Label>
            <Input value={(schoolAddress.state || '').toUpperCase()} onChange={(e) => setSchoolAddress({ ...schoolAddress, state: e.target.value.toUpperCase().slice(0, 2) })} disabled={!isEditingAddress} className={disabledInputClasses(!isEditingAddress)} />
            <Label className="text-xs text-muted-foreground mt-2">CEP</Label>
            <Input value={formatCepBR(schoolAddress.cep || '')} onChange={(e) => setSchoolAddress({ ...schoolAddress, cep: onlyDigits(e.target.value) })} disabled={!isEditingAddress} className={disabledInputClasses(!isEditingAddress)} />
          </div>
        </CardContent>
      </Card>

      {profile.role?.toUpperCase() === 'ADMIN' && (
        <Card
          className={`${profileCardClassName} transition-all duration-200 ${
            isEditingFinance
              ? profileEditingCardClassName
              : ''
          }`}
        >
          <CardHeader className={profileCardHeaderClassName}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className={profileCardTitleClassName}>Dados financeiros</CardTitle>
                <CardDescription className={profileCardDescriptionClassName}>
                  Informações usadas na ativação financeira
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {isEditingFinance && (
                  <div className={profileEditingBadgeClassName}>
                    <Edit className="h-4 w-4" />
                    <span className="text-sm font-medium">Modo de edição</span>
                  </div>
                )}
                <EditActions
                  isEditing={isEditingFinance}
                  isSaving={isSavingFinance}
                  onEdit={() => setIsEditingFinance(true)}
                  onCancel={() => {
                    setFinanceForm(financeFormInitial);
                    setIsEditingFinance(false);
                  }}
                  onSave={saveFinanceInline}
                  saveDisabled={financeSaveDisabled()}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 py-6">
            {commercialInfoStatusValue === 'EXPIRING_SOON' && (
              <Alert variant="warning" className="mb-6">
                <AlertTitle>Confirmação anual pendente</AlertTitle>
                <AlertDescription>
                  Seus dados comerciais precisam ser confirmados em breve
                  {commercialInfoScheduledDate ? ` (até ${commercialInfoScheduledDate})` : ''}. Revise e envie o
                  cadastro financeiro para evitar bloqueio.
                </AlertDescription>
                <div className="mt-3">
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/finance/wizard">Atualizar dados comerciais</Link>
                  </Button>
                </div>
              </Alert>
            )}

            {commercialInfoStatusValue === 'EXPIRED' && (
              <Alert variant="destructive" className="mb-6">
                <AlertTitle>Dados comerciais expirados</AlertTitle>
                <AlertDescription>
                  A conta financeira foi bloqueada até a confirmação anual dos dados. Atualize os dados para regularizar o
                  acesso.
                </AlertDescription>
                <div className="mt-3">
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/finance/wizard">Regularizar agora</Link>
                  </Button>
                </div>
              </Alert>
            )}

            {financeLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : financeError ? (
              <div className="text-sm text-red-600">{financeError}</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">CPF/CNPJ</Label>
                  <Input
                    value={
                      financeSnapshot?.financialAccount?.commercialInfo?.cpfCnpj
                        ? formatCpfCnpjBR(financeSnapshot.financialAccount.commercialInfo!.cpfCnpj!)
                        : '-'
                    }
                    disabled
                    className={disabledInputClasses(true)}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Pessoa</Label>
                  <Input
                    value={financeSnapshot?.financialAccount?.commercialInfo?.personType ?? '-'}
                    disabled
                    className={disabledInputClasses(true)}
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">E-mail da conta</Label>
                  <Input
                    value={profile?.email ?? '-'}
                    disabled
                    className={disabledInputClasses(true)}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Telefone</Label>
                  <Input
                    value={
                      isEditingFinance
                        ? financeForm.phone
                        : financeSnapshot?.financialAccount?.commercialInfo?.phone
                          ? formatPhoneBR(financeSnapshot.financialAccount.commercialInfo!.phone)
                          : '-'
                    }
                    placeholder={isEditingFinance ? '(00) 0000-0000' : undefined}
                    disabled={!isEditingFinance}
                    onChange={(e) =>
                      setFinanceForm((prev) => ({ ...prev, phone: formatPhoneBR(e.target.value) }))
                    }
                    className={disabledInputClasses(!isEditingFinance)}
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Celular</Label>
                  <Input
                    value={
                      isEditingFinance
                        ? financeForm.mobilePhone
                        : financeSnapshot?.financialAccount?.commercialInfo?.mobilePhone
                          ? formatPhoneBR(financeSnapshot.financialAccount.commercialInfo!.mobilePhone)
                          : financeSnapshot?.financeProfile?.mobilePhone
                            ? formatPhoneBR(financeSnapshot.financeProfile.mobilePhone)
                            : '-'
                    }
                    placeholder={isEditingFinance ? '(00) 00000-0000' : undefined}
                    disabled={!isEditingFinance}
                    onChange={(e) =>
                      setFinanceForm((prev) => ({ ...prev, mobilePhone: formatPhoneBR(e.target.value) }))
                    }
                    className={disabledInputClasses(!isEditingFinance)}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Renda mensal</Label>
                  <Input
                    value={
                      isEditingFinance
                        ? financeForm.incomeValue
                        : financeSnapshot?.financialAccount?.commercialInfo?.incomeValue != null
                          ? formatCurrencyBRL(financeSnapshot.financialAccount.commercialInfo!.incomeValue)
                          : financeSnapshot?.financeProfile?.incomeValue != null
                            ? formatCurrencyBRL(financeSnapshot.financeProfile.incomeValue)
                            : '-'
                    }
                    placeholder={isEditingFinance ? 'Ex.: 3.500,00' : undefined}
                    inputMode={isEditingFinance ? 'decimal' : undefined}
                    disabled={!isEditingFinance}
                    onChange={(e) => setFinanceForm((prev) => ({ ...prev, incomeValue: e.target.value }))}
                    className={disabledInputClasses(!isEditingFinance)}
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Site</Label>
                  <Input
                    value={isEditingFinance ? financeForm.site : financeSnapshot?.financialAccount?.commercialInfo?.site ?? '-'}
                    placeholder={isEditingFinance ? 'https://www.exemplo.com' : undefined}
                    disabled={!isEditingFinance}
                    onChange={(e) => setFinanceForm((prev) => ({ ...prev, site: e.target.value }))}
                    className={disabledInputClasses(!isEditingFinance)}
                  />
                </div>

                {isEditingFinance ? (
                  <>
                    <div className="sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Endereço</Label>
                      <Input
                        value={financeForm.address}
                        onChange={(e) => setFinanceForm((prev) => ({ ...prev, address: e.target.value }))}
                        disabled={!isEditingFinance}
                        className={disabledInputClasses(!isEditingFinance)}
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Número</Label>
                      <Input
                        value={financeForm.addressNumber}
                        onChange={(e) =>
                          setFinanceForm((prev) => ({ ...prev, addressNumber: e.target.value }))
                        }
                        disabled={!isEditingFinance}
                        className={disabledInputClasses(!isEditingFinance)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Bairro</Label>
                      <Input
                        value={financeForm.province}
                        onChange={(e) => setFinanceForm((prev) => ({ ...prev, province: e.target.value }))}
                        disabled={!isEditingFinance}
                        className={disabledInputClasses(!isEditingFinance)}
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">CEP</Label>
                      <Input
                        value={formatCepBR(financeForm.postalCode)}
                        onChange={(e) =>
                          setFinanceForm((prev) => ({ ...prev, postalCode: onlyDigits(e.target.value) }))
                        }
                        placeholder="00000-000"
                        disabled={!isEditingFinance}
                        className={disabledInputClasses(!isEditingFinance)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Complemento</Label>
                      <Input
                        value={financeForm.complement}
                        onChange={(e) =>
                          setFinanceForm((prev) => ({ ...prev, complement: e.target.value }))
                        }
                        disabled={!isEditingFinance}
                        className={disabledInputClasses(!isEditingFinance)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-2">
                    <Label className="text-xs text-muted-foreground">Endereço</Label>
                    <Input
                      value={(() => {
                        const address =
                          financeSnapshot?.financialAccount?.commercialInfo?.address ??
                          financeSnapshot?.financeProfile?.address;
                        const addressNumber =
                          financeSnapshot?.financialAccount?.commercialInfo?.addressNumber ??
                          financeSnapshot?.financeProfile?.addressNumber;
                        const province =
                          financeSnapshot?.financialAccount?.commercialInfo?.province ??
                          financeSnapshot?.financeProfile?.province;
                        const postalCode =
                          financeSnapshot?.financialAccount?.commercialInfo?.postalCode ??
                          financeSnapshot?.financeProfile?.postalCode;

                        const parts = [
                          address ? address.trim() : '',
                          addressNumber ? addressNumber.trim() : '',
                          province ? province.trim() : '',
                          postalCode ? formatCepBR(postalCode) : '',
                        ].filter(Boolean);

                        return parts.length ? parts.join(' • ') : '-';
                      })()}
                      disabled
                      className={disabledInputClasses(true)}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4. Preferências */}
      <Card className={`${profileCardClassName} transition-all duration-200 ${
        isEditingPrefs
          ? profileEditingCardClassName
          : ''
      }`}>
        <CardHeader className={profileCardHeaderClassName}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={profileCardTitleClassName}>Preferências</CardTitle>
              <CardDescription className={profileCardDescriptionClassName}>
                Personalize sua experiência na plataforma
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isEditingPrefs && (
                <div className={profileEditingBadgeClassName}>
                  <Edit className="h-4 w-4" />
                  <span className="text-sm font-medium">Modo de edição</span>
                </div>
              )}
              <EditActions
                isEditing={isEditingPrefs}
                isSaving={isSavingPrefs}
                onEdit={() => setIsEditingPrefs(true)}
                onCancel={() => {
                  setFormLocale(profile.locale ?? 'pt-BR');
                  setFormTheme(profile.theme ?? 'system');
                  setIsEditingPrefs(false);
                }}
                onSave={handleSavePrefs}
                saveDisabled={!prefsDirty}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6 grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Tema</Label>
            {isEditingPrefs ? (
              <Select value={formTheme} onValueChange={setFormTheme}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFILE_THEME_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={profile.theme || 'system'}
                disabled
                className={disabledInputClasses(true)}
              />
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Idioma</Label>
            {isEditingPrefs ? (
              <Select value={formLocale} onValueChange={setFormLocale}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFILE_LOCALE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={profile.locale || 'pt-BR'}
                disabled
                className={disabledInputClasses(true)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog de crop de imagem */}
      {(() => {
        console.log('🖼️ Renderizando ImageCropDialog:', { 
          cropDialogOpen, 
          hasImageToCrop: !!imageToCrop,
          imageToCropLength: imageToCrop?.length 
        });
        return null;
      })()}
      <ImageCropDialog
        open={cropDialogOpen}
        onOpenChange={(open) => {
          console.log('📊 Dialog onOpenChange:', open);
          setCropDialogOpen(open);
        }}
        src={imageToCrop}
        aspect={1}
        round={true}
        maxZoom={3}
        exportMime="image/jpeg"
        exportQuality={0.9}
        exportSize={512}
        title="Ajustar foto de perfil"
        onApply={handleCropApply}
      />
    </section>
  );
}

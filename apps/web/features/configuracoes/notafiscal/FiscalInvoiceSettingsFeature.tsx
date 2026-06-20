'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { isValidPisCofinsTaxStatus } from '@alusa/finance/fiscal-wizard-client';
import {
  DEFAULT_FISCAL_FORM,
  formatCnae,
  formatDigitsOnly,
  formatMunicipalInscription,
  formatRpsSerie,
  formatStateInscription,
  formatAedf,
  getSubscriptionInvoicePeriodExample,
  labelForPortalRegime,
  labelForSpecialTaxRegime,
  mergeSerializableDraftWithSettings,
  settingsToFormDraft,
} from './fiscal-form-utils';
import { FiscalCertificateUploadField } from './FiscalCertificateUploadField';
import { FiscalNbsCodeField } from './FiscalNbsCodeField';
import { FiscalServiceFormDialog } from './FiscalServiceFormDialog';
import {
  clearFiscalWizardDraft,
  hasMeaningfulFiscalWizardDraft,
  readFiscalWizardDraft,
  stripFiscalWizardSecrets,
  writeFiscalWizardDraft,
} from './fiscal-wizard-draft-storage';
import {
  FISCAL_WIZARD_FIELD_CLASS,
  FISCAL_WIZARD_PANEL_CLASS,
  FiscalFieldError,
  FiscalFieldLabel,
  FiscalSelect,
  FiscalTextField,
  fiscalInputClass,
} from './FiscalWizardFields';
import {
  useFiscalInvoiceSettings,
  type SaveFiscalSettingsPayload,
} from './hooks/useFiscalInvoiceSettings';
import { FiscalSettingsSaveError } from './hooks/fiscal-settings-save-error';
import {
  FISCAL_WIZARD_STEP_LABELS,
  validateFiscalSettingsDraft,
  validateFiscalWizardStep,
  type FiscalSettingsValidationContext,
  type FiscalSettingsValidationIssue,
  type FiscalWizardStepId,
} from '@alusa/finance/fiscal-wizard-client';

const STEPS = [
  'Emissor e acesso',
  'Informações fiscais',
  'Serviço',
  'Automação',
  'Revisão',
] as const;

const WIZARD_STEP_IDS: FiscalWizardStepId[] = [
  'prefeitura',
  'informacoes',
  'servico',
  'padroes',
];

function stepIndexForLabel(label: string): number {
  const idx = WIZARD_STEP_IDS.findIndex((id) => FISCAL_WIZARD_STEP_LABELS[id] === label);
  return idx >= 0 ? idx : 0;
}

function issuesToFieldErrors(issues: FiscalSettingsValidationIssue[]): Record<string, string> {
  return Object.fromEntries(issues.map((issue) => [issue.field, issue.message]));
}

type MunicipalOptions = {
  authenticationType?: string;
  suggestedAccessMethod?: string;
  municipalInscriptionHelp?: string;
  specialTaxRegimeHelp?: string;
  serviceListItemHelp?: string;
  digitalCertificatedHelp?: string;
  accessTokenHelp?: string;
  usesServiceListItem?: boolean;
  usesSpecialTaxRegimes?: boolean;
  usesStateInscription?: boolean;
  usesAedf?: boolean;
  usesNbs?: boolean;
  stateInscriptionHelp?: string;
  aedfHelp?: string;
  specialTaxRegimesList?: Array<{ label: string; value: string }>;
  nationalPortalTaxCalculationRegimeList?: Array<{ label: string; value: string }>;
  nationalPortalTaxCalculationRegimeHelp?: string;
};

const TEMPLATE_VARS = [
  { key: '{aluno}', label: 'Aluno' },
  { key: '{responsavel}', label: 'Responsável' },
  { key: '{competencia}', label: 'Competência' },
  { key: '{matricula}', label: 'Matrícula' },
  { key: '{turma}', label: 'Turma' },
  { key: '{plano}', label: 'Plano' },
  { key: '{contrato}', label: 'Contrato' },
];

function issuerLabel(useNationalPortal?: boolean | null): string {
  return useNationalPortal ? 'Portal Nacional da NFS-e' : 'Prefeitura municipal';
}

function accessMethodLabel(accessMethod?: string | null): string {
  if (accessMethod === 'USER_PASSWORD') return 'Usuário e senha';
  if (accessMethod === 'TOKEN') return 'Token';
  if (accessMethod === 'CERTIFICATE') return 'Certificado digital';
  return '—';
}

export function FiscalInvoiceSettingsFeature() {
  const { data: session } = useSession();
  const contaId = (session?.user as { contaId?: string } | undefined)?.contaId;

  const {
    data,
    loading,
    saving,
    savingCore,
    error,
    fetchSettings,
    saveSettings,
    saveCoreSettings,
    fetchMunicipalOptions,
    fetchMunicipalServices,
    fetchNbsCodes,
    fetchFiscalReferenceCodes,
    deleteService,
    syncSettings,
  } = useFiscalInvoiceSettings();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [municipalOptions, setMunicipalOptions] = useState<MunicipalOptions | null>(null);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | undefined>();
  const [deleteServiceTarget, setDeleteServiceTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [syncingSettings, setSyncingSettings] = useState(false);

  const [form, setForm] = useState<SaveFiscalSettingsPayload>(DEFAULT_FISCAL_FORM);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!contaId) return;
    setHasLocalDraft(hasMeaningfulFiscalWizardDraft(contaId));
  }, [contaId]);

  // Hidrata formulário a partir do rascunho local (prioridade) ou do servidor.
  useEffect(() => {
    if (wizardOpen || !contaId) return;
    const draft = readFiscalWizardDraft(contaId);
    if (draft) {
      setForm(mergeSerializableDraftWithSettings(draft.form, data?.settings));
      return;
    }
    if (data?.settings) {
      setForm(settingsToFormDraft(data.settings));
    }
  }, [data?.settings, wizardOpen, contaId]);

  // Persiste rascunho enquanto o wizard estiver aberto.
  useEffect(() => {
    if (!wizardOpen || !contaId) return;
    writeFiscalWizardDraft(contaId, {
      form: stripFiscalWizardSecrets(form),
      step,
    });
    setHasLocalDraft(hasMeaningfulFiscalWizardDraft(contaId));
  }, [wizardOpen, contaId, form, step]);

  const accessMethod = form.accessMethod ?? municipalOptions?.suggestedAccessMethod ?? undefined;

  const validationContext = useMemo<FiscalSettingsValidationContext>(
    () => ({
      municipalOptions: municipalOptions as FiscalSettingsValidationContext['municipalOptions'],
      passwordConfigured: data?.settings?.passwordConfigured,
      accessTokenConfigured: data?.settings?.accessTokenConfigured,
      certificateConfigured: data?.settings?.certificateConfigured,
      defaultServiceExists: data?.services.some((service) => service.isDefault),
      useNationalPortal: form.useNationalPortal ?? data?.settings?.useNationalPortal ?? false,
    }),
    [data, municipalOptions, form.useNationalPortal],
  );

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function showValidationToast(stepId: FiscalWizardStepId, issues: FiscalSettingsValidationIssue[]) {
    const stepLabel = FISCAL_WIZARD_STEP_LABELS[stepId];
    const summary =
      issues.length === 1
        ? issues[0].message
        : `${issues.length} campos precisam de atenção neste passo.`;
    toast.custom((t) => (
      <CustomToast
        variant="error"
        title={`Revise: ${stepLabel}`}
        description={summary}
        onClose={() => toast.dismiss(t)}
      />
    ));
  }

  function applyValidationIssues(issues: FiscalSettingsValidationIssue[]) {
    setFieldErrors(issuesToFieldErrors(issues));
    const firstStep = issues[0]?.step;
    if (firstStep) {
      setStep(indexForStepId(firstStep));
      showValidationToast(firstStep, issues.filter((issue) => issue.step === firstStep));
    }
  }

  function indexForStepId(stepId: FiscalWizardStepId): number {
    return WIZARD_STEP_IDS.indexOf(stepId);
  }

  function validateCurrentStep(): FiscalSettingsValidationIssue[] {
    const stepId = WIZARD_STEP_IDS[step];
    if (!stepId) return [];
    return validateFiscalWizardStep(stepId, form, validationContext);
  }

  const fiscalCoreSynced = Boolean(data?.settings?.asaasFiscalSyncedAt);

  async function handleAdvance() {
    const issues = validateCurrentStep();
    if (issues.length > 0) {
      setFieldErrors(issuesToFieldErrors(issues));
      showValidationToast(WIZARD_STEP_IDS[step], issues);
      return;
    }

    if (step === 1) {
      try {
        setFieldErrors({});
        await saveCoreSettings(form);
        await fetchSettings({ silent: true });
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Informações fiscais salvas"
            description="Agora você pode cadastrar o serviço municipal na lista oficial."
            onClose={() => toast.dismiss(t)}
          />
        ));
      } catch (e) {
        if (e instanceof FiscalSettingsSaveError) {
          if (e.issues.length > 0) {
            applyValidationIssues(e.issues);
          } else if (e.step) {
            setStep(stepIndexForLabel(e.step));
          }
          toast.custom((t) => (
            <CustomToast
              variant="error"
              title={e.step ? `Erro em ${e.step}` : 'Erro ao salvar informações fiscais'}
              description={
                e.details.length > 0 ? e.details.slice(0, 3).join(' · ') : e.message
              }
              onClose={() => toast.dismiss(t)}
            />
          ));
        } else {
          toast.custom((t) => (
            <CustomToast
              variant="error"
              title="Erro ao salvar informações fiscais"
              description={e instanceof Error ? e.message : 'Tente novamente.'}
              onClose={() => toast.dismiss(t)}
            />
          ));
        }
        return;
      }
    }

    setFieldErrors({});
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  async function startWizard() {
    setWizardOpen(true);
    setFieldErrors({});

    const draft = contaId ? readFiscalWizardDraft(contaId) : null;
    if (draft) {
      setForm(mergeSerializableDraftWithSettings(draft.form, data?.settings));
      setStep(Math.min(Math.max(0, draft.step), STEPS.length - 1));
    } else {
      setStep(0);
      setForm(data?.settings ? settingsToFormDraft(data.settings) : DEFAULT_FISCAL_FORM);
    }

    try {
      const options = await fetchMunicipalOptions();
      setMunicipalOptions(options);
      if (!draft?.form.accessMethod && !data?.settings?.accessMethod && options?.suggestedAccessMethod) {
        setForm((f) => ({ ...f, accessMethod: options.suggestedAccessMethod }));
      }
    } catch {
      setMunicipalOptions(data?.municipalOptions as MunicipalOptions | null);
    }
  }

  async function handleSyncSettings() {
    setSyncingSettings(true);
    try {
      await syncSettings();
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Configuração revalidada"
          description="Os dados fiscais foram revalidados com sucesso."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Falha ao revalidar"
          description={e instanceof Error ? e.message : 'Tente novamente.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSyncingSettings(false);
    }
  }

  async function handleSave() {
    const issues = validateFiscalSettingsDraft(form, validationContext);
    if (issues.length > 0) {
      applyValidationIssues(issues);
      return;
    }

    try {
      setFieldErrors({});
      await saveSettings(form);
      await fetchSettings();
      if (contaId) {
        clearFiscalWizardDraft(contaId);
        setHasLocalDraft(false);
      }
      setWizardOpen(false);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Configuração salva"
          description="As informações fiscais da escola foram atualizadas."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (e) {
      if (e instanceof FiscalSettingsSaveError) {
        if (e.issues.length > 0) {
          applyValidationIssues(e.issues);
        } else if (e.step) {
          setStep(stepIndexForLabel(e.step));
        }
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title={e.step ? `Erro em ${e.step}` : 'Erro ao salvar'}
            description={
              e.details.length > 0 ? e.details.slice(0, 3).join(' · ') : e.message
            }
            onClose={() => toast.dismiss(t)}
          />
        ));
        return;
      }
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao salvar"
          description={e instanceof Error ? e.message : 'Tente novamente.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }

  async function handleDeleteService() {
    if (!deleteServiceTarget) return;
    try {
      await deleteService(deleteServiceTarget.id);
      await fetchSettings({ silent: true });
      setFieldErrors((prev) => {
        if (!prev.defaultService) return prev;
        const next = { ...prev };
        delete next.defaultService;
        return next;
      });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Serviço excluído"
          description="O serviço municipal foi removido da configuração."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao excluir"
          description={e instanceof Error ? e.message : 'Tente novamente.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
      throw e;
    }
  }

  const checklist = useMemo(() => {
    const stepIssues = validateFiscalSettingsDraft(form, validationContext);
    const issuesByStep = (stepId: FiscalWizardStepId) =>
      stepIssues.filter((issue) => issue.step === stepId);

    return [
      {
        label: 'Emissor e acesso configurados',
        ok: issuesByStep('prefeitura').length === 0,
        hint:
          issuesByStep('prefeitura')[0]?.message ??
          'Escolha o emissor da NFS-e e informe as credenciais exigidas pela prefeitura ou pelo Portal Nacional.',
      },
      {
        label: 'Informações fiscais preenchidas',
        ok: issuesByStep('informacoes').length === 0,
        hint:
          issuesByStep('informacoes')[0]?.message ??
          'Inscrição municipal, RPS, regime especial e NBS quando exigidos.',
      },
      {
        label: 'Serviço fiscal padrão',
        ok: issuesByStep('servico').length === 0,
        hint:
          issuesByStep('servico')[0]?.message ??
          'Cadastre um serviço municipal e marque um como padrão.',
      },
      {
        label: 'Automação fiscal definida',
        ok: true,
        hint: 'A Alusa usará o modo escolhido para cobranças e assinaturas.',
      },
    ];
  }, [form, validationContext]);

  const subscriptionPeriodExample = useMemo(
    () =>
      form.emissionMode === 'ON_PAYMENT'
        ? getSubscriptionInvoicePeriodExample({
            period: form.invoiceEffectiveDatePeriod,
            daysBeforeDueDate: form.invoiceDaysBeforeDueDate,
            receivedOnly: form.invoiceReceivedOnly,
          })
        : null,
    [
      form.emissionMode,
      form.invoiceEffectiveDatePeriod,
      form.invoiceDaysBeforeDueDate,
      form.invoiceReceivedOnly,
    ],
  );

  if (loading && !data) {
    return <p className="text-sm text-slate-600">Carregando configuração fiscal…</p>;
  }

  const configurationComplete = Boolean(data?.readiness.ready);
  const hasPartialProgress =
    hasLocalDraft ||
    Boolean(data?.configured && !configurationComplete) ||
    (data?.services.length ?? 0) > 0;
  const showEmpty = !wizardOpen && !configurationComplete && !hasPartialProgress;
  const resumeConfigurationLabel = configurationComplete
    ? 'Editar configuração'
    : 'Retornar configuração';
  const fiscalSettings = data?.settings;
  const syncStatusLabel =
    fiscalSettings?.syncStatus === 'DIVERGED'
      ? 'Divergente'
      : fiscalSettings?.syncStatus === 'PENDING'
        ? 'Pendente'
        : 'Sincronizado';
  const portalEnabled = fiscalSettings?.useNationalPortal ?? false;
  const lastSyncedAt = fiscalSettings?.lastSyncedAt
    ? new Date(fiscalSettings.lastSyncedAt).toLocaleString('pt-BR')
    : '—';
  const asaasFiscalSyncedAt = fiscalSettings?.asaasFiscalSyncedAt
    ? new Date(fiscalSettings.asaasFiscalSyncedAt).toLocaleString('pt-BR')
    : '—';
  const rpsSerieHelp = form.useNationalPortal
    ? accessMethod === 'CERTIFICATE'
      ? 'No Portal Nacional com certificado digital, use série entre 00001 e 49999.'
      : accessMethod === 'USER_PASSWORD'
        ? 'No Portal Nacional com usuário e senha, use série entre 80000 e 89999.'
        : 'No padrão nacional, a série RPS varia conforme a forma de autenticação configurada.'
    : 'Na emissão municipal, a maioria das cidades utiliza a série 1 ou E.';

  return (
    <div className="space-y-6" data-testid="fiscal-invoice-settings">
      <header className="space-y-1">
        <h2 className="text-xl font-medium tracking-tight text-gray-900 md:text-2xl">Nota Fiscal</h2>
        <p className="max-w-3xl text-sm text-gray-600">
          Configure a emissão de Notas Fiscais de Serviço para mensalidades, matrículas e cobranças.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {data?.configured && !wizardOpen ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-slate-900">Status de sincronização fiscal</p>
                <p className="text-xs text-slate-600">
                  {syncStatusLabel} · Alusa {lastSyncedAt} · Emissor {asaasFiscalSyncedAt}
                </p>
              </div>
              {fiscalSettings?.lastSyncError ? (
                <p className="max-w-2xl text-xs text-red-600">{fiscalSettings.lastSyncError}</p>
              ) : null}
              <p className="text-sm text-slate-800">
                Emissor atual:{' '}
                <span className="font-medium text-slate-950">{issuerLabel(portalEnabled)}</span>
              </p>
              <p className="max-w-2xl text-xs text-slate-500">
                Para alterar o emissor, edite a configuração fiscal. Essa escolha pode exigir novas
                credenciais, série RPS e revalidação da configuração.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleSyncSettings}
              disabled={syncingSettings}
              className="w-full md:w-auto"
            >
              {syncingSettings ? 'Revalidando...' : 'Revalidar configuração'}
            </Button>
          </div>
        </div>
      ) : null}

      {showEmpty ? (
        <section className={cn(FISCAL_WIZARD_PANEL_CLASS, 'px-5 py-12 md:px-8 md:py-14')}>
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <div className="w-full space-y-3">
              <h3 className="text-base font-medium tracking-tight text-slate-900 md:text-lg">
                Configure a emissão de Notas Fiscais de Serviço
              </h3>
              <InfoCallout
                size="sm"
                className="w-full bg-slate-100 text-left text-slate-600"
              >
                Defina o emissor fiscal, os dados da escola, os serviços prestados e as regras de emissão
                para gerar NFS-e vinculadas às cobranças de mensalidades, matrículas e demais receitas.
                Você também pode automatizar a emissão após a confirmação do pagamento.
              </InfoCallout>
              <InfoCallout
                variant="info"
                size="sm"
                showIcon
                className="w-full whitespace-nowrap text-left"
              >
                Precisa de ajuda? Consulte sua contabilidade sobre códigos de serviço municipal.
              </InfoCallout>
            </div>
            <Button className="mt-8" onClick={startWizard}>
              Iniciar configuração
            </Button>
          </div>
        </section>
      ) : null}

      {data?.readiness.ready && !wizardOpen ? (
        <InfoCallout variant="brand" size="sm">
          <InfoCalloutItem label="Pronto para emissão">
            A escola está configurada para emitir NFS-e usando {issuerLabel(portalEnabled).toLowerCase()}.
          </InfoCalloutItem>
        </InfoCallout>
      ) : null}

      {!configurationComplete && hasPartialProgress && !wizardOpen ? (
        <InfoCallout variant="warning" size="sm">
          <InfoCalloutItem label="Configuração em andamento" labelTone="warning">
            {hasLocalDraft
              ? 'Você tem um rascunho salvo do último acesso. Retome de onde parou.'
              : null}
            {hasLocalDraft && data?.readiness.issues.length ? ' · ' : null}
            {data?.readiness.issues.map((i) => i.message).join(' · ') ||
              'Conclua os passos pendentes para habilitar a emissão de NFSe.'}
          </InfoCalloutItem>
        </InfoCallout>
      ) : null}

      {wizardOpen || (!showEmpty && hasPartialProgress) || (data?.configured && configurationComplete) ? (
        <div className="space-y-6">
          {!wizardOpen && !showEmpty ? (
            <Button variant="outline" onClick={startWizard}>
              {resumeConfigurationLabel}
            </Button>
          ) : null}

          {wizardOpen ? (
            <>
              <ol className="flex flex-wrap gap-2">
                {STEPS.map((label, index) => (
                  <li
                    key={label}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium',
                      index === step
                        ? 'bg-purple-100 text-purple-800'
                        : index < step
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-white text-slate-400 ring-1 ring-slate-200',
                    )}
                  >
                    {index + 1}. {label}
                  </li>
                ))}
              </ol>

              {step === 0 ? (
                <div className={FISCAL_WIZARD_PANEL_CLASS}>
                  <div className={FISCAL_WIZARD_FIELD_CLASS}>
                    <FiscalFieldLabel
                      label="Emissor da NFS-e"
                      help="Escolha se a emissão será feita pelo sistema da prefeitura municipal ou pelo Portal Nacional da NFS-e."
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        {
                          enabled: false,
                          title: 'Prefeitura municipal',
                          description: 'Usa a integração fiscal da prefeitura da cidade.',
                        },
                        {
                          enabled: true,
                          title: 'Portal Nacional da NFS-e',
                          description: 'Usa o portal nacional como emissor oficial da NFS-e.',
                        },
                      ].map((option) => {
                        const active = Boolean(form.useNationalPortal) === option.enabled;
                        return (
                          <button
                            key={option.title}
                            type="button"
                            aria-pressed={active}
                            className={cn(
                              'rounded-lg border p-3 text-left transition',
                              active
                                ? 'border-purple-500 bg-purple-50 text-purple-950 ring-1 ring-purple-200'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
                            )}
                            onClick={() => {
                              setForm((f) => ({
                                ...f,
                                useNationalPortal: option.enabled,
                                nationalPortalTaxCalculationRegime: option.enabled
                                  ? f.nationalPortalTaxCalculationRegime
                                  : undefined,
                              }));
                            }}
                          >
                            <span className="block text-sm font-medium">{option.title}</span>
                            <span className="mt-1 block text-xs text-slate-600">
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {municipalOptions === null ? (
                    <InfoCallout variant="warning" size="sm">
                      <InfoCalloutItem label="Revalidação necessária" labelTone="warning">
                        Não foi possível carregar os requisitos fiscais do emissor. Revalide antes de
                        salvar a configuração.
                      </InfoCalloutItem>
                    </InfoCallout>
                  ) : null}

                  <div className={FISCAL_WIZARD_FIELD_CLASS}>
                    <FiscalFieldLabel
                      label="E-mail fiscal"
                      help="E-mail usado para alertas e notificações da emissão fiscal."
                    />
                    <Input
                      type="email"
                      value={form.fiscalEmail}
                      className={fiscalInputClass(Boolean(fieldErrors.fiscalEmail))}
                      onChange={(e) => {
                        clearFieldError('fiscalEmail');
                        setForm((f) => ({ ...f, fiscalEmail: e.target.value }));
                      }}
                    />
                    <FiscalFieldError message={fieldErrors.fiscalEmail} />
                  </div>

                  {accessMethod === 'USER_PASSWORD' || municipalOptions?.authenticationType === 'USER_AND_PASSWORD' ? (
                    <>
                      <FiscalTextField
                        label="Usuário de acesso"
                        value={form.username ?? ''}
                        error={fieldErrors.username}
                        onChange={(value) => {
                          clearFieldError('username');
                          setForm((f) => ({ ...f, username: value }));
                        }}
                      />
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <FiscalFieldLabel label="Senha de acesso" />
                        <Input
                          type="password"
                          className={fiscalInputClass(Boolean(fieldErrors.password))}
                          placeholder={data?.settings?.passwordConfigured ? '••••••••' : ''}
                          onChange={(e) => {
                            clearFieldError('password');
                            setForm((f) => ({ ...f, password: e.target.value }));
                          }}
                        />
                        <FiscalFieldError message={fieldErrors.password} />
                      </div>
                    </>
                  ) : null}

                  {accessMethod === 'TOKEN' || municipalOptions?.authenticationType === 'TOKEN' ? (
                    <div className={FISCAL_WIZARD_FIELD_CLASS}>
                      <FiscalFieldLabel
                        label="Token de acesso"
                        help={municipalOptions?.accessTokenHelp}
                      />
                      <Input
                        type="password"
                        className={fiscalInputClass(Boolean(fieldErrors.accessToken))}
                        placeholder={data?.settings?.accessTokenConfigured ? '••••••••' : ''}
                        onChange={(e) => {
                          clearFieldError('accessToken');
                          setForm((f) => ({ ...f, accessToken: e.target.value }));
                        }}
                      />
                      <FiscalFieldError message={fieldErrors.accessToken} />
                    </div>
                  ) : null}

                  {accessMethod === 'CERTIFICATE' || municipalOptions?.authenticationType === 'CERTIFICATE' ? (
                    <>
                      <InfoCallout variant="info" size="sm">
                        <InfoCalloutItem label="Certificado digital">
                          {municipalOptions?.digitalCertificatedHelp ??
                            'O emissor exige certificado digital A1 para emissão.'}
                        </InfoCalloutItem>
                      </InfoCallout>
                      <FiscalCertificateUploadField
                        file={form.certificateFile}
                        certificateConfigured={data?.settings?.certificateConfigured}
                        error={fieldErrors.certificateFile}
                        onChange={(certificateFile) => {
                          setForm((f) => ({ ...f, certificateFile }));
                        }}
                        onClearError={() => clearFieldError('certificateFile')}
                        onReject={(message) => {
                          setFieldErrors((prev) => ({ ...prev, certificateFile: message }));
                        }}
                      />
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <Label>Senha do certificado</Label>
                        <Input
                          type="password"
                          className={fiscalInputClass(Boolean(fieldErrors.certificatePassword))}
                          onChange={(e) => {
                            clearFieldError('certificatePassword');
                            setForm((f) => ({ ...f, certificatePassword: e.target.value }));
                          }}
                        />
                        <FiscalFieldError message={fieldErrors.certificatePassword} />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {step === 1 ? (
                <div className={FISCAL_WIZARD_PANEL_CLASS}>
                  <FiscalTextField
                    label="Inscrição municipal"
                    help={municipalOptions?.municipalInscriptionHelp}
                    value={form.municipalInscription ?? ''}
                    error={fieldErrors.municipalInscription}
                    placeholder="00.00.00"
                    inputMode="numeric"
                    onChange={(value) => {
                      clearFieldError('municipalInscription');
                      setForm((f) => ({
                        ...f,
                        municipalInscription: formatMunicipalInscription(value),
                      }));
                    }}
                  />

                  {municipalOptions?.usesStateInscription ? (
                    <FiscalTextField
                      label="Inscrição estadual"
                      help={municipalOptions.stateInscriptionHelp}
                      value={form.stateInscription ?? ''}
                      error={fieldErrors.stateInscription}
                      onChange={(value) => {
                        clearFieldError('stateInscription');
                        setForm((f) => ({
                          ...f,
                          stateInscription: formatStateInscription(value),
                        }));
                      }}
                    />
                  ) : null}

                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <Checkbox
                        checked={form.simplesNacional}
                        onCheckedChange={(c) =>
                          setForm((f) => ({ ...f, simplesNacional: c === true }))
                        }
                      />
                      Optante pelo Simples Nacional
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <Checkbox
                        checked={form.culturalProjectsPromoter ?? false}
                        onCheckedChange={(c) =>
                          setForm((f) => ({ ...f, culturalProjectsPromoter: c === true }))
                        }
                      />
                      Incentivador cultural
                    </label>
                  </div>

                  <FiscalTextField
                    label="CNAE"
                    help="Código numérico de 7 dígitos."
                    value={form.cnae ?? ''}
                    placeholder="8599699"
                    inputMode="numeric"
                    onChange={(value) => setForm((f) => ({ ...f, cnae: formatCnae(value) }))}
                  />

                  {municipalOptions?.usesSpecialTaxRegimes ? (
                    municipalOptions.specialTaxRegimesList?.length ? (
                      <FiscalSelect
                        label="Regime especial de tributação"
                        help={municipalOptions.specialTaxRegimeHelp}
                        value={form.specialTaxRegime}
                        options={municipalOptions.specialTaxRegimesList}
                        error={fieldErrors.specialTaxRegime}
                        onChange={(value) => {
                          clearFieldError('specialTaxRegime');
                          setForm((f) => ({ ...f, specialTaxRegime: value }));
                        }}
                      />
                    ) : (
                      <FiscalTextField
                        label="Regime especial de tributação"
                        help={municipalOptions.specialTaxRegimeHelp}
                        value={form.specialTaxRegime ?? ''}
                        error={fieldErrors.specialTaxRegime}
                        placeholder="0"
                        inputMode="numeric"
                        onChange={(value) => {
                          clearFieldError('specialTaxRegime');
                          setForm((f) => ({ ...f, specialTaxRegime: value }));
                        }}
                      />
                    )
                  ) : null}

                  {municipalOptions?.usesServiceListItem ? (
                    <FiscalTextField
                      label="Item da lista de serviço"
                      help={municipalOptions.serviceListItemHelp}
                      value={form.serviceListItem ?? ''}
                      error={fieldErrors.serviceListItem}
                      onChange={(value) => {
                        clearFieldError('serviceListItem');
                        setForm((f) => ({ ...f, serviceListItem: value }));
                      }}
                    />
                  ) : null}

                  {municipalOptions?.usesAedf ? (
                    <FiscalTextField
                      label="AEDF"
                      help={
                        municipalOptions.aedfHelp ??
                        'Autorização Eletrônica de Documentos Fiscais exigida pela prefeitura.'
                      }
                      value={form.aedf ?? ''}
                      error={fieldErrors.aedf}
                      onChange={(value) => {
                        clearFieldError('aedf');
                        setForm((f) => ({ ...f, aedf: formatAedf(value) }));
                      }}
                    />
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FiscalTextField
                      label="Série RPS"
                      help={rpsSerieHelp}
                      value={form.rpsSerie ?? ''}
                      error={fieldErrors.rpsSerie}
                      placeholder={form.useNationalPortal ? '80001' : '1'}
                      onChange={(value) => {
                        clearFieldError('rpsSerie');
                        setForm((f) => ({ ...f, rpsSerie: formatRpsSerie(value) }));
                      }}
                    />
                    <FiscalTextField
                      label="Próximo RPS"
                      value={form.rpsNumber != null ? String(form.rpsNumber) : ''}
                      error={fieldErrors.rpsNumber}
                      placeholder="1"
                      inputMode="numeric"
                      onChange={(value) => {
                        clearFieldError('rpsNumber');
                        const digits = formatDigitsOnly(value, 9);
                        setForm((f) => ({
                          ...f,
                          rpsNumber: digits === '' ? undefined : Number(digits),
                        }));
                      }}
                    />
                  </div>

                  <FiscalTextField
                    label="Lote"
                    help={
                      municipalOptions?.usesAedf
                        ? 'Informe o próximo número de lote se a prefeitura exigir controle por lote.'
                        : undefined
                    }
                    value={form.loteNumber != null ? String(form.loteNumber) : ''}
                    inputMode="numeric"
                    onChange={(value) => {
                      const digits = formatDigitsOnly(value, 9);
                      setForm((f) => ({
                        ...f,
                        loteNumber: digits === '' ? undefined : Number(digits),
                      }));
                    }}
                  />

                  {form.useNationalPortal || data?.settings?.useNationalPortal ? (
                    municipalOptions?.nationalPortalTaxCalculationRegimeList?.length ? (
                      <FiscalSelect
                        label="Regime Portal Nacional"
                        help={municipalOptions.nationalPortalTaxCalculationRegimeHelp}
                        value={form.nationalPortalTaxCalculationRegime}
                        options={municipalOptions.nationalPortalTaxCalculationRegimeList}
                        error={fieldErrors.nationalPortalTaxCalculationRegime}
                        onChange={(value) => {
                          clearFieldError('nationalPortalTaxCalculationRegime');
                          setForm((f) => ({
                            ...f,
                            nationalPortalTaxCalculationRegime: value,
                          }));
                        }}
                      />
                    ) : (
                      <FiscalTextField
                        label="Regime Portal Nacional"
                        help={municipalOptions?.nationalPortalTaxCalculationRegimeHelp}
                        value={form.nationalPortalTaxCalculationRegime ?? ''}
                        error={fieldErrors.nationalPortalTaxCalculationRegime}
                        onChange={(value) => {
                          clearFieldError('nationalPortalTaxCalculationRegime');
                          setForm((f) => ({
                            ...f,
                            nationalPortalTaxCalculationRegime: value,
                          }));
                        }}
                      />
                    )
                  ) : null}

                  {municipalOptions?.usesNbs !== false ? (
                    <FiscalNbsCodeField
                      value={form.nbsCode ?? ''}
                      error={fieldErrors.nbsCode}
                      onSearch={fetchNbsCodes}
                      onChange={(value) => {
                        clearFieldError('nbsCode');
                        setForm((f) => ({ ...f, nbsCode: value }));
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {step === 2 ? (
                <div className={FISCAL_WIZARD_PANEL_CLASS}>
                  {!fiscalCoreSynced ? (
                    <InfoCallout variant="warning" size="sm">
                      <InfoCalloutItem label="Ordem recomendada" labelTone="warning">
                        Conclua emissor e informações fiscais no passo anterior antes de cadastrar
                        serviços municipais.
                      </InfoCalloutItem>
                    </InfoCallout>
                  ) : (
                    <InfoCallout variant="info" size="sm">
                      <InfoCalloutItem label="Serviços municipais">
                        Com as informações fiscais já salvas, busque o serviço na lista oficial e
                        marque um como padrão para emissão.
                      </InfoCalloutItem>
                    </InfoCallout>
                  )}
                  <FiscalFieldError message={fieldErrors.defaultService} />
                  {(data?.services.length ?? 0) === 0 ? (
                    <p className="text-sm text-slate-600">Nenhum serviço cadastrado ainda.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data?.services.map((service) => (
                        <li
                          key={service.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate text-gray-900">
                            {service.name}{' '}
                            {service.isDefault ? (
                              <span className="text-xs text-purple-700">(padrão)</span>
                            ) : null}
                            <span className="ml-2 text-xs text-gray-500">
                              {service.asaasMunicipalServiceId ? 'lista municipal' : 'manual'}
                            </span>
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingServiceId(service.id);
                                setServiceDialogOpen(true);
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() =>
                                setDeleteServiceTarget({ id: service.id, name: service.name })
                              }
                            >
                              Excluir
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    variant="outline"
                    disabled={!fiscalCoreSynced}
                    onClick={() => {
                      setEditingServiceId(undefined);
                      setServiceDialogOpen(true);
                    }}
                  >
                    Adicionar serviço
                  </Button>
                </div>
              ) : null}

              {step === 3 ? (
                <div className={FISCAL_WIZARD_PANEL_CLASS}>
                  <div className="space-y-1.5">
                    <Label>Descrição padrão da NFSe</Label>
                    <Textarea
                      rows={3}
                      value={form.defaultDescriptionTemplate ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, defaultDescriptionTemplate: e.target.value }))
                      }
                    />
                    <div className="flex flex-wrap gap-2 pt-1">
                      {TEMPLATE_VARS.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          className="rounded-md bg-white px-2 py-0.5 text-xs ring-1 ring-slate-200 hover:bg-slate-50"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              defaultDescriptionTemplate: `${f.defaultDescriptionTemplate ?? ''}${v.key}`,
                            }))
                          }
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Observações padrão</Label>
                    <Textarea
                      rows={2}
                      value={form.defaultObservations ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, defaultObservations: e.target.value }))
                      }
                    />
                  </div>
                  <FiscalSelect
                    label="Modo de emissão"
                    help="No modo automático, taxa, avulsas e parcelas são emitidas pela Alusa; mensalidades e assinaturas usam a emissão nativa do Asaas."
                    value={form.emissionMode ?? 'MANUAL'}
                    options={[
                      { label: 'Manual: emitir pela tela da cobrança', value: 'MANUAL' },
                      { label: 'Automático: ao confirmar pagamento', value: 'ON_PAYMENT' },
                    ]}
                    onChange={(value) =>
                      setForm((f) => ({
                        ...f,
                        emissionMode: value === 'ON_PAYMENT' ? 'ON_PAYMENT' : 'MANUAL',
                      }))
                    }
                  />
                  {form.emissionMode === 'ON_PAYMENT' ? (
                    <>
                      <FiscalSelect
                        label="Período de emissão em assinaturas"
                        help="Define quando o Asaas emite a NFS-e das mensalidades e assinaturas com configuração nativa."
                        value={form.invoiceEffectiveDatePeriod ?? 'ON_PAYMENT_CONFIRMATION'}
                        options={[
                          {
                            label: 'Ao confirmar pagamento',
                            value: 'ON_PAYMENT_CONFIRMATION',
                          },
                          {
                            label: 'No vencimento da cobrança',
                            value: 'ON_PAYMENT_DUE_DATE',
                          },
                          {
                            label: 'Antes do vencimento',
                            value: 'BEFORE_PAYMENT_DUE_DATE',
                          },
                          {
                            label: 'No 1º dia do mês do vencimento',
                            value: 'ON_DUE_DATE_MONTH',
                          },
                          {
                            label: 'No 1º dia do mês seguinte',
                            value: 'ON_NEXT_MONTH',
                          },
                        ]}
                        onChange={(value) =>
                          setForm((f) => ({
                            ...f,
                            invoiceEffectiveDatePeriod:
                              value === 'ON_PAYMENT_DUE_DATE' ||
                              value === 'BEFORE_PAYMENT_DUE_DATE' ||
                              value === 'ON_DUE_DATE_MONTH' ||
                              value === 'ON_NEXT_MONTH'
                                ? value
                                : 'ON_PAYMENT_CONFIRMATION',
                            invoiceDaysBeforeDueDate:
                              value === 'BEFORE_PAYMENT_DUE_DATE'
                                ? f.invoiceDaysBeforeDueDate ?? 5
                                : undefined,
                            invoiceReceivedOnly:
                              value === 'ON_NEXT_MONTH' ? f.invoiceReceivedOnly ?? false : true,
                          }))
                        }
                      />
                      {form.invoiceEffectiveDatePeriod === 'BEFORE_PAYMENT_DUE_DATE' ? (
                        <FiscalSelect
                          label="Dias antes do vencimento"
                          value={String(form.invoiceDaysBeforeDueDate ?? 5)}
                          options={[
                            { label: '5 dias antes', value: '5' },
                            { label: '10 dias antes', value: '10' },
                            { label: '15 dias antes', value: '15' },
                            { label: '30 dias antes', value: '30' },
                            { label: '60 dias antes', value: '60' },
                          ]}
                          onChange={(value) =>
                            setForm((f) => ({
                              ...f,
                              invoiceDaysBeforeDueDate: Number(value),
                            }))
                          }
                        />
                      ) : null}
                      {form.invoiceEffectiveDatePeriod === 'ON_NEXT_MONTH' ? (
                        <label className="flex items-center gap-2 text-sm text-gray-900">
                          <Checkbox
                            checked={form.invoiceReceivedOnly ?? false}
                            onCheckedChange={(checked) =>
                              setForm((f) => ({ ...f, invoiceReceivedOnly: checked === true }))
                            }
                          />
                          Emitir somente para cobranças recebidas no mês anterior
                        </label>
                      ) : null}
                      {subscriptionPeriodExample ? (
                        <InfoCallout variant="brand" size="sm">
                          <InfoCalloutItem label={subscriptionPeriodExample.label}>
                            {subscriptionPeriodExample.description}
                          </InfoCalloutItem>
                        </InfoCallout>
                      ) : null}
                    </>
                  ) : null}
                  <InfoCallout variant="info" size="sm">
                    <InfoCalloutItem label="Automação fiscal">
                      Mensalidades e assinaturas são emitidas pelo Asaas conforme o período
                      configurado. Taxa de matrícula, cobranças avulsas e parcelas são emitidas
                      pela Alusa quando o pagamento é confirmado.
                    </InfoCalloutItem>
                  </InfoCallout>
                </div>
              ) : null}

              {step === 4 ? (
                <div className={cn(FISCAL_WIZARD_PANEL_CLASS, 'space-y-6')}>
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-900">Resumo das informações fiscais</h3>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">Emissor da NFS-e</dt>
                        <dd className="text-sm font-medium text-gray-900">
                          {issuerLabel(form.useNationalPortal)}
                        </dd>
                      </div>
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">Autenticação</dt>
                        <dd className="text-sm font-medium text-gray-900">
                          {accessMethodLabel(accessMethod)}
                        </dd>
                      </div>
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">Inscrição municipal</dt>
                        <dd className="text-sm font-medium text-gray-900">
                          {form.municipalInscription || '—'}
                        </dd>
                      </div>
                      {municipalOptions?.usesStateInscription ? (
                        <div className={FISCAL_WIZARD_FIELD_CLASS}>
                          <dt className="text-xs text-gray-500">Inscrição estadual</dt>
                          <dd className="text-sm font-medium text-gray-900">
                            {form.stateInscription || '—'}
                          </dd>
                        </div>
                      ) : null}
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">CNAE</dt>
                        <dd className="text-sm font-medium text-gray-900">{form.cnae || '—'}</dd>
                      </div>
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">Regime especial</dt>
                        <dd className="text-sm font-medium text-gray-900">
                          {labelForSpecialTaxRegime(
                            form.specialTaxRegime,
                            municipalOptions?.specialTaxRegimesList,
                          )}
                        </dd>
                      </div>
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">Série / próximo RPS</dt>
                        <dd className="text-sm font-medium text-gray-900">
                          {form.rpsSerie || '—'} / {form.rpsNumber ?? '—'}
                        </dd>
                      </div>
                      {form.useNationalPortal ? (
                        <div className={FISCAL_WIZARD_FIELD_CLASS}>
                          <dt className="text-xs text-gray-500">Regime Portal Nacional</dt>
                          <dd className="text-sm font-medium text-gray-900">
                            {labelForPortalRegime(
                              form.nationalPortalTaxCalculationRegime,
                              municipalOptions?.nationalPortalTaxCalculationRegimeList,
                            )}
                          </dd>
                        </div>
                      ) : null}
                      <div className={FISCAL_WIZARD_FIELD_CLASS}>
                        <dt className="text-xs text-gray-500">NBS</dt>
                        <dd className="text-sm font-medium text-gray-900">{form.nbsCode || '—'}</dd>
                      </div>
                      {municipalOptions?.usesAedf ? (
                        <div className={FISCAL_WIZARD_FIELD_CLASS}>
                          <dt className="text-xs text-gray-500">AEDF</dt>
                          <dd className="text-sm font-medium text-gray-900">{form.aedf || '—'}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                      {form.simplesNacional ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5">Simples Nacional</span>
                      ) : null}
                      {form.culturalProjectsPromoter ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5">Incentivador cultural</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="border-t border-[#e5e7eb] pt-4">
                    <h3 className="mb-3 text-sm font-medium text-gray-900">Checklist de configuração</h3>
                    {checklist.map((item) => (
                      <div key={item.label} className="mb-3 space-y-1 last:mb-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className={item.ok ? 'text-green-700' : 'text-amber-700'}>
                            {item.ok ? '✓' : '○'}
                          </span>
                          <span>{item.label}</span>
                        </div>
                        {!item.ok ? (
                          <p className="pl-6 text-xs text-amber-700">{item.hint}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  Voltar
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={() => void handleAdvance()} disabled={savingCore}>
                    {savingCore && step === 1 ? 'Salvando…' : 'Avançar'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleSave}
                    disabled={saving || checklist.some((item) => !item.ok)}
                  >
                    {saving ? 'Salvando…' : 'Salvar configuração'}
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {!wizardOpen && !data?.configured && !showEmpty ? (
        <InfoCallout variant="info" size="sm" showIcon className="w-fit max-w-full whitespace-nowrap">
          Precisa de ajuda? Consulte sua contabilidade sobre códigos de serviço municipal.
        </InfoCallout>
      ) : null}

      <FiscalServiceFormDialog
        open={serviceDialogOpen}
        onOpenChange={setServiceDialogOpen}
        initial={
          (() => {
            const service = editingServiceId
              ? data?.services.find((s) => s.id === editingServiceId)
              : undefined;
            if (!service) return undefined;
            return {
              ...service,
              nationalTaxCode: service.nationalTaxCode ?? undefined,
              nbsCode: service.nbsCode ?? undefined,
              defaultDescription: service.defaultDescription ?? undefined,
              asaasMunicipalServiceId: service.asaasMunicipalServiceId ?? undefined,
              taxSituationCode: service.taxSituationCode ?? undefined,
              taxClassificationCode: service.taxClassificationCode ?? undefined,
              operationIndicatorCode: service.operationIndicatorCode ?? undefined,
              pisCofinsTaxStatus:
                service.pisCofinsTaxStatus && isValidPisCofinsTaxStatus(service.pisCofinsTaxStatus)
                  ? service.pisCofinsTaxStatus
                  : undefined,
              useTaxSystemReformNT007: service.useTaxSystemReformNT007 ?? false,
            };
          })()
        }
        onSaved={() => void fetchSettings({ silent: true })}
        onSearchMunicipalServices={fetchMunicipalServices}
        onSearchNbsCodes={async (query) => {
          const result = await fetchNbsCodes(query);
          return { data: result.data };
        }}
        onSearchFiscalReferenceCodes={async (kind, query) => {
          const result = await fetchFiscalReferenceCodes(kind, query);
          return { data: result.data };
        }}
        useNationalPortal={Boolean(data?.settings?.useNationalPortal)}
        simplesNacional={data?.settings?.simplesNacional ?? true}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteServiceTarget)}
        title="Excluir serviço municipal"
        description={
          deleteServiceTarget
            ? `Deseja excluir "${deleteServiceTarget.name}"? Esta ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Excluir serviço"
        onOpenChange={(open) => {
          if (!open) setDeleteServiceTarget(null);
        }}
        onConfirm={handleDeleteService}
      />
    </div>
  );
}

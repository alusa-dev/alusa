import type { SerializableFiscalFormDraft } from './fiscal-form-utils';
import type { SaveFiscalSettingsPayload } from './hooks/useFiscalInvoiceSettings';

const STORAGE_PREFIX = 'alusa.fiscal-wizard-draft.v1';

export type FiscalWizardDraftSnapshot = {
  form: SerializableFiscalWizardForm;
  step: number;
  updatedAt: string;
};

/** Campos persistidos localmente — sem segredos nem arquivos. */
export type SerializableFiscalWizardForm = SerializableFiscalFormDraft;

export function getFiscalWizardDraftKey(contaId: string) {
  return `${STORAGE_PREFIX}:${contaId}`;
}

export function stripFiscalWizardSecrets(
  form: SaveFiscalSettingsPayload,
): SerializableFiscalWizardForm {
  const {
    password: _password,
    accessToken: _accessToken,
    certificatePassword: _certificatePassword,
    certificateFile: _certificateFile,
    ...rest
  } = form;
  return rest;
}

export function readFiscalWizardDraft(contaId: string): FiscalWizardDraftSnapshot | null {
  if (typeof window === 'undefined' || !contaId) return null;
  try {
    const raw = window.localStorage.getItem(getFiscalWizardDraftKey(contaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FiscalWizardDraftSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.form || typeof parsed.step !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeFiscalWizardDraft(
  contaId: string,
  snapshot: Pick<FiscalWizardDraftSnapshot, 'form' | 'step'>,
) {
  if (typeof window === 'undefined' || !contaId) return;
  const payload: FiscalWizardDraftSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(getFiscalWizardDraftKey(contaId), JSON.stringify(payload));
}

export function clearFiscalWizardDraft(contaId: string) {
  if (typeof window === 'undefined' || !contaId) return;
  window.localStorage.removeItem(getFiscalWizardDraftKey(contaId));
}

export function hasMeaningfulFiscalWizardDraft(contaId: string): boolean {
  const draft = readFiscalWizardDraft(contaId);
  if (!draft) return false;
  const { form } = draft;
  return Boolean(
    form.fiscalEmail?.trim() ||
      form.municipalInscription?.trim() ||
      form.cnae?.trim() ||
      form.specialTaxRegime?.trim() ||
      form.nbsCode?.trim() ||
      form.rpsSerie?.trim() ||
      form.rpsNumber != null ||
      form.useNationalPortal === true ||
      form.defaultDescriptionTemplate?.trim() ||
      form.username?.trim() ||
      draft.step > 0,
  );
}

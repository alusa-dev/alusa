import type { FiscalSettingsValidationIssue } from '@alusa/finance/fiscal-wizard-client';

export class FiscalSettingsSaveError extends Error {
  step?: string;
  details: string[];
  issues: FiscalSettingsValidationIssue[];
  code: string;

  constructor(input: {
    message: string;
    code?: string;
    step?: string;
    details?: string[];
    issues?: FiscalSettingsValidationIssue[];
  }) {
    super(input.message);
    this.name = 'FiscalSettingsSaveError';
    this.code = input.code ?? 'ERRO_AO_SALVAR';
    this.step = input.step;
    this.details = input.details ?? [];
    this.issues = input.issues ?? [];
  }
}

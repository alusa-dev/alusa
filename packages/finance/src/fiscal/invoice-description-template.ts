export type InvoiceDescriptionContext = {
  aluno?: string | null;
  responsavel?: string | null;
  competencia?: string | null;
  matricula?: string | null;
  turma?: string | null;
  plano?: string | null;
  contrato?: string | null;
};

const VARIABLE_PATTERN = /\{(aluno|responsavel|competencia|matricula|turma|plano|contrato)\}/gi;

function normalizeBuiltInvoiceDescription(text: string): string {
  return text
    .replace(/\s*[—–-]\s*[—–-]+\s*/g, ' — ')
    .replace(/\s*[—–-]\s*(competência|competencia)\s*$/i, '')
    .replace(/\s*(competência|competencia)\s*$/i, '')
    .replace(/\s*[—–-]\s*$/g, '')
    .replace(/^\s*[—–-]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function buildInvoiceDescriptionFromTemplate(
  template: string,
  context: InvoiceDescriptionContext,
): string {
  const built = template.replace(VARIABLE_PATTERN, (_match, key: string) => {
    const normalized = key.toLowerCase() as keyof InvoiceDescriptionContext;
    const value = context[normalized];
    return value?.trim() ? value.trim() : '';
  });

  return normalizeBuiltInvoiceDescription(built);
}

export const DEFAULT_INVOICE_DESCRIPTION_TEMPLATE =
  'Serviços educacionais — {aluno} — competência {competencia}';

export const INVOICE_TEMPLATE_VARIABLES = [
  { key: 'aluno', label: 'Aluno' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'competencia', label: 'Competência' },
  { key: 'matricula', label: 'Matrícula' },
  { key: 'turma', label: 'Turma' },
  { key: 'plano', label: 'Plano' },
  { key: 'contrato', label: 'Contrato' },
] as const;

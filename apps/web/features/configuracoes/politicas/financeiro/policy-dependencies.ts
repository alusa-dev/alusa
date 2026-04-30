import type { ContaFinancialPolicyDTO, UpdateContaFinancialPolicyInputDTO } from './dtos';

export const REMATRICULA_POLICY_PRESETS = ['FLEXIVEL', 'CONTROLADA', 'RESTRITIVA'] as const;
export const REMATRICULA_DEBT_SCOPES = ['QUALQUER_COBRANCA_EM_ABERTO', 'APENAS_VENCIDAS'] as const;
export const FINANCIAL_POLICY_OVERRIDE_ROLES = ['ADMIN', 'FINANCEIRO', 'RECEPCAO'] as const;

type FinancialPolicyInput = ContaFinancialPolicyDTO | UpdateContaFinancialPolicyInputDTO;

const DEFAULT_OVERRIDE_ROLES = ['ADMIN', 'FINANCEIRO'] as const;

export function normalizeFinancialPolicyConfig<T extends FinancialPolicyInput>(
  input: T,
  options?: { useDefaultOverrideRoles?: boolean },
): T {
  const validRoles = Array.from(
    new Set(input.overrideRoles.filter((role) => FINANCIAL_POLICY_OVERRIDE_ROLES.includes(role as never))),
  );

  const normalizedOverrideRoles =
    input.preset === 'CONTROLADA'
      ? validRoles.length > 0
        ? validRoles
        : options?.useDefaultOverrideRoles
          ? [...DEFAULT_OVERRIDE_ROLES]
          : []
      : [];

  return {
    ...input,
    debtScope: input.debtScope ?? 'QUALQUER_COBRANCA_EM_ABERTO',
    overrideRoles: normalizedOverrideRoles,
  } satisfies T;
}

export function validateFinancialPolicyConfig(input: FinancialPolicyInput): {
  success: boolean;
  normalized: FinancialPolicyInput;
  issues: string[];
} {
  const normalized = normalizeFinancialPolicyConfig(input);
  const issues: string[] = [];

  if (normalized.preset === 'CONTROLADA' && normalized.overrideRoles.length === 0) {
    issues.push('Selecione pelo menos um perfil autorizado para liberar exceções.');
  }

  return {
    success: issues.length === 0,
    normalized,
    issues,
  };
}

export function getDebtScopeLabel(scope: FinancialPolicyInput['debtScope']) {
  return scope === 'APENAS_VENCIDAS' ? 'cobranças vencidas' : 'qualquer cobrança em aberto';
}

export function getPresetLabel(preset: FinancialPolicyInput['preset']) {
  switch (preset) {
    case 'CONTROLADA':
      return 'Exigir autorização';
    case 'RESTRITIVA':
      return 'Bloquear até regularização';
    case 'FLEXIVEL':
    default:
      return 'Permitir com alerta';
  }
}

export function buildFinancialPolicySummary(input: FinancialPolicyInput) {
  const normalized = normalizeFinancialPolicyConfig(input, { useDefaultOverrideRoles: true });
  const scopeLabel = getDebtScopeLabel(normalized.debtScope);

  switch (normalized.preset) {
    case 'CONTROLADA':
      return `Exige autorização quando houver ${scopeLabel}.`;
    case 'RESTRITIVA':
      return `Bloqueia a rematrícula quando houver ${scopeLabel} ou situação financeira inconclusiva.`;
    case 'FLEXIVEL':
    default:
      return `Permite a rematrícula com alerta quando houver ${scopeLabel}.`;
  }
}

export function buildFinancialPolicyPreview(input: FinancialPolicyInput) {
  const normalized = normalizeFinancialPolicyConfig(input, { useDefaultOverrideRoles: true });
  const scopeLabel = getDebtScopeLabel(normalized.debtScope);

  switch (normalized.preset) {
    case 'CONTROLADA':
      return `Se houver ${scopeLabel}, a rematrícula exigirá autorização dos perfis selecionados e motivo obrigatório.`;
    case 'RESTRITIVA':
      return `Se houver ${scopeLabel}, a rematrícula ficará bloqueada até regularização. Casos inconclusivos também serão bloqueados.`;
    case 'FLEXIVEL':
    default:
      return `Se houver ${scopeLabel}, a rematrícula seguirá com alerta para a equipe, sem exigir autorização manual.`;
  }
}

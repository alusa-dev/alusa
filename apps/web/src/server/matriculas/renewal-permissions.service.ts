export type RenewalPermission =
  | 'renewal.campaign.create'
  | 'renewal.campaign.manage'
  | 'renewal.process.confirm'
  | 'renewal.process.edit_future'
  | 'renewal.process.cancel'
  | 'renewal.exception.grant'
  | 'renewal.fee.exempt'
  | 'renewal.finance.resolve'
  | 'renewal.activation.force'
  | 'renewal.pending.resolve'
  | 'renewal.portal.view';

const allStaffPermissions: RenewalPermission[] = [
  'renewal.campaign.create',
  'renewal.campaign.manage',
  'renewal.process.confirm',
  'renewal.process.edit_future',
  'renewal.process.cancel',
  'renewal.exception.grant',
  'renewal.fee.exempt',
  'renewal.finance.resolve',
  'renewal.activation.force',
  'renewal.pending.resolve',
  'renewal.portal.view',
];

const permissionsByRole: Record<string, ReadonlySet<RenewalPermission>> = {
  ADMIN: new Set(allStaffPermissions),
  FINANCEIRO: new Set([
    'renewal.process.confirm',
    'renewal.process.edit_future',
    'renewal.process.cancel',
    'renewal.exception.grant',
    'renewal.fee.exempt',
    'renewal.finance.resolve',
    'renewal.pending.resolve',
    'renewal.portal.view',
  ]),
  RECEPCAO: new Set([
    'renewal.process.confirm',
    'renewal.process.edit_future',
    'renewal.process.cancel',
    'renewal.pending.resolve',
    'renewal.portal.view',
  ]),
  PROFESSOR: new Set([]),
  RESPONSAVEL: new Set(['renewal.portal.view']),
};

export class RenewalPermissionError extends Error {
  code = 'PERMISSAO_REMATRICULA_NEGADA';

  constructor(public readonly permission: RenewalPermission) {
    super(`Permissão de rematrícula negada: ${permission}`);
    this.name = 'RenewalPermissionError';
  }
}

function normalizeRole(role?: string | null) {
  return role?.trim().toUpperCase() || '';
}

export function hasRenewalPermission(role: string | null | undefined, permission: RenewalPermission) {
  return permissionsByRole[normalizeRole(role)]?.has(permission) ?? false;
}

export function requireRenewalPermission(input: {
  role: string | null | undefined;
  permission: RenewalPermission;
}) {
  if (!hasRenewalPermission(input.role, input.permission)) {
    throw new RenewalPermissionError(input.permission);
  }
}


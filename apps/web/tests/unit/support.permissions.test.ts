/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import {
  canManageSupportUsers,
  canRunFinanceActions,
  canViewTechnicalLogs,
  canWriteSupportNotes,
} from '@/features/support/auth/permissions';

describe('support permissions', () => {
  it('separa papéis administrativos, financeiros e técnicos', () => {
    expect(canManageSupportUsers('SUPPORT_ADMIN')).toBe(true);
    expect(canManageSupportUsers('SUPPORT_AGENT')).toBe(false);

    expect(canRunFinanceActions('SUPPORT_FINANCE')).toBe(true);
    expect(canRunFinanceActions('SUPPORT_DEVELOPER')).toBe(false);

    expect(canViewTechnicalLogs('SUPPORT_DEVELOPER')).toBe(true);
    expect(canViewTechnicalLogs('SUPPORT_VIEWER')).toBe(false);
  });

  it('permite notas a partir de agente de suporte', () => {
    expect(canWriteSupportNotes('SUPPORT_VIEWER')).toBe(false);
    expect(canWriteSupportNotes('SUPPORT_AGENT')).toBe(true);
    expect(canWriteSupportNotes('BREAK_GLASS')).toBe(true);
  });
});

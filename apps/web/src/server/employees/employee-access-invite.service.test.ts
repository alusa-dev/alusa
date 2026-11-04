import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(),
  findTarget: vi.fn(),
  sendEmail: vi.fn(),
  getBaseUrl: vi.fn(),
  log: vi.fn(),
  findMembership: vi.fn(),
  findPendingInvite: vi.fn(),
}));

vi.mock('@alusa/lib/server/services/invite-user-service', () => ({
  createInvite: mocks.createInvite,
  DuplicateInviteError: class DuplicateInviteError extends Error {},
  ForbiddenRoleError: class ForbiddenRoleError extends Error {},
  InvalidInviteTargetError: class InvalidInviteTargetError extends Error {},
  MissingContaError: class MissingContaError extends Error {},
  UserAlreadyLinkedError: class UserAlreadyLinkedError extends Error {},
  UserInactiveError: class UserInactiveError extends Error {},
}));
vi.mock('@/src/server/users/invite-scope.service', () => ({ findInviteTargetInConta: mocks.findTarget }));
vi.mock('@/lib/auth-email-flow', () => ({ sendInviteEmail: mocks.sendEmail }));
vi.mock('@/lib/app-url', () => ({ getInviteBaseUrl: mocks.getBaseUrl }));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request-1', logApiOperationalEvent: mocks.log }));
vi.mock('@/lib/prisma', () => ({ default: { usuarioConta: { findFirst: mocks.findMembership }, invite: { findMany: mocks.findPendingInvite } } }));

import { DuplicateInviteError } from '@alusa/lib/server/services/invite-user-service';
import { inviteEmployeeAccess } from './employee-access-invite.service';

describe('inviteEmployeeAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTarget.mockResolvedValue({ email: 'staff@example.com', accessStatus: 'NONE' });
    mocks.findMembership.mockResolvedValue({ role: 'ADMIN' });
    mocks.findPendingInvite.mockResolvedValue([]);
    mocks.getBaseUrl.mockReturnValue('https://app.example.com');
    mocks.createInvite.mockResolvedValue({ id: 'invite-1', token: 'secret-token', expiresAt: new Date('2030-01-01') });
    mocks.sendEmail.mockResolvedValue({ delivery: 'sent' });
  });

  it('keeps the saved record usable and returns a manual link when email delivery fails', async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error('mail unavailable'));

    const result = await inviteEmployeeAccess({
      contaId: 'school-a',
      invitedById: 'admin-a',
      recordId: 'employee-a',
      email: 'staff@example.com',
      role: 'RECEPCAO',
    });

    expect(mocks.findTarget).toHaveBeenCalledWith('school-a', {
      recordType: 'COLABORADOR',
      recordId: 'employee-a',
    });
    expect(mocks.createInvite).toHaveBeenCalledWith(
      'staff@example.com',
      'RECEPCAO',
      'admin-a',
      'school-a',
      { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-a' } },
    );
    expect(result).toMatchObject({ status: 'failed', inviteUrl: 'https://app.example.com/auth/register?token=secret-token' });
  });

  it('does not create a second invite for an already active local access', async () => {
    mocks.findTarget.mockResolvedValueOnce({ email: 'staff@example.com', accessStatus: 'ACTIVE' });

    const result = await inviteEmployeeAccess({
      contaId: 'school-a', invitedById: 'admin-a', recordId: 'employee-a',
      email: 'staff@example.com', role: 'RECEPCAO',
    });

    expect(result.status).toBe('already_active');
    expect(mocks.createInvite).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('denies a non-admin actor using the live active membership role', async () => {
    mocks.findMembership.mockResolvedValueOnce({ role: 'PROFESSOR' });

    const result = await inviteEmployeeAccess({
      contaId: 'school-a', invitedById: 'teacher-a', recordId: 'employee-a',
      email: 'staff@example.com', role: 'FINANCEIRO',
    });

    expect(result.status).toBe('failed');
    expect(mocks.createInvite).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('recovers the same pending invite link after delivery failure and request retry', async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error('mail unavailable'));
    mocks.createInvite
      .mockResolvedValueOnce({ id: 'invite-1', token: 'same-token', expiresAt: new Date('2030-01-01') })
      .mockRejectedValueOnce(new DuplicateInviteError());
    mocks.findPendingInvite.mockResolvedValueOnce([{
      email: 'staff@example.com', role: 'RECEPCAO', token: 'same-token',
      metadata: { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-a' } },
    }]);

    const input = {
      contaId: 'school-a', invitedById: 'admin-a', recordId: 'employee-a',
      email: 'staff@example.com', role: 'RECEPCAO' as const,
    };
    const first = await inviteEmployeeAccess(input);
    const retry = await inviteEmployeeAccess(input);

    expect(first.status).toBe('failed');
    expect(retry).toMatchObject({
      status: 'pending',
      inviteUrl: 'https://app.example.com/auth/register?token=same-token',
    });
    expect(mocks.createInvite).toHaveBeenCalledTimes(2);
    expect(mocks.findPendingInvite).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'school-a', status: 'PENDING' }),
    }));
  });

  it('does not reuse a pending invite with a different role', async () => {
    mocks.createInvite.mockRejectedValueOnce(new DuplicateInviteError());
    mocks.findPendingInvite.mockResolvedValueOnce([{
      email: 'staff@example.com', role: 'PROFESSOR', token: 'must-not-leak',
      metadata: { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-a' } },
    }]);

    const result = await inviteEmployeeAccess({
      contaId: 'school-a', invitedById: 'admin-a', recordId: 'employee-a',
      email: 'staff@example.com', role: 'RECEPCAO',
    });

    expect(result.status).toBe('failed');
    expect(result.inviteUrl).toBeUndefined();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

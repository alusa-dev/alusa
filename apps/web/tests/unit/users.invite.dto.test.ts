import { describe, expect, it } from 'vitest';
import { createInviteInputDTOSchema, inviteSummaryDTOSchema } from '@/features/users/dtos';
import { mapCreatedInviteRecordToDTO, mapInviteRecordToDTO } from '@/features/users/mappers';

describe('invite API DTOs', () => {
  it('accepts canonical targets and the current email request shape', () => {
    expect(createInviteInputDTOSchema.parse({
      target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: 'guardian-1', role: 'RESPONSAVEL' },
    })).toMatchObject({ target: { kind: 'EXISTING_RECORD', recordId: 'guardian-1' } });
    expect(createInviteInputDTOSchema.parse({ email: ' PERSON@EXAMPLE.TEST ', role: 'RECEPCAO' }))
      .toEqual({ email: 'person@example.test', role: 'RECEPCAO' });
  });

  it('projects invite rows without token or metadata and exposes only link in create output', () => {
    const record = {
      id: 'invite-1', email: 'person@example.test', role: 'RECEPCAO', status: 'PENDING',
      createdAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: new Date('2026-01-04T00:00:00.000Z'),
      token: 'secret-token', metadata: { private: 'secret' },
    };
    const listed = mapInviteRecordToDTO(record);
    expect(listed).not.toHaveProperty('token');
    expect(listed).not.toHaveProperty('metadata');
    expect(listed).not.toHaveProperty('inviteUrl');
    expect(() => inviteSummaryDTOSchema.parse({ ...listed, token: 'secret-token' })).toThrow();

    const created = mapCreatedInviteRecordToDTO({
      ...record, inviteUrl: 'https://school.example/auth/register?token=secret-token',
    });
    expect(created).toHaveProperty('inviteUrl');
    expect(created).not.toHaveProperty('token');
    expect(created).not.toHaveProperty('metadata');
  });
});

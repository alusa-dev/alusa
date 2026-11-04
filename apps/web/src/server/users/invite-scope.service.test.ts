import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { findInviteCandidatesInConta, findInviteTargetInConta, findStudentsInContaForInvite } from './invite-scope.service';

describe('findStudentsInContaForInvite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('limits the invite validation query to the active school and requested students', async () => {
    const findMany = vi.spyOn(prisma.aluno, 'findMany').mockResolvedValue([{ id: 'student-1' }] as never);

    await expect(findStudentsInContaForInvite('school-a', ['student-1'])).resolves.toEqual([
      { id: 'student-1' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { contaId: 'school-a', id: { in: ['student-1'] } },
      select: { id: true },
    });
  });

  it('lists only local collaborator records and derives access plus pending state from the same tenant', async () => {
    const collaboratorFindMany = vi.spyOn(prisma.colaborador, 'findMany').mockResolvedValue([{
      id: 'employee-1', nome: 'Employee', email: 'employee@example.test',
      usuario: { status: 'ATIVO', acessosConta: [{ status: 'ATIVO' }] },
    }] as never);
    const inviteFindMany = vi.spyOn(prisma.invite, 'findMany').mockResolvedValue([
      { email: 'employee@example.test', metadata: null },
    ] as never);

    await expect(findInviteCandidatesInConta({
      contaId: 'school-a', recordType: 'COLABORADOR', page: 1, limit: 10,
    })).resolves.toEqual({
      items: [{
        kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-1',
        name: 'Employee', email: 'employee@example.test', students: [], accessStatus: 'ACTIVE',
        inviteStatus: 'PENDING', canInvite: false,
      }],
      hasMore: false,
    });
    expect(collaboratorFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'school-a', status: 'ATIVO' }),
      select: expect.objectContaining({ id: true, email: true, usuario: expect.any(Object) }),
      skip: 0, take: 11,
    }));
    expect(inviteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'school-a', OR: expect.any(Array) }),
      select: { email: true, metadata: true },
    }));
  });

  it('scopes responsible candidates to linked local records and does not request CPF', async () => {
    const responsibleFindMany = vi.spyOn(prisma.responsavel, 'findMany').mockResolvedValue([{
      id: 'guardian-1', nome: 'Responsible', email: 'guardian@example.test', usuario: { status: 'ATIVO', acessosConta: [] },
      alunos: [{ alunoId: 'student-1', aluno: { id: 'student-1', nome: 'Aluno um', contaId: 'school-a' } }],
    }] as never);
    vi.spyOn(prisma.invite, 'findMany').mockResolvedValue([] as never);

    const result = await findInviteCandidatesInConta({
      contaId: 'school-a', recordType: 'RESPONSAVEL', page: 2, limit: 5, query: 'guard',
    });

    expect(result.items[0]).toMatchObject({
      accessStatus: 'NONE', inviteStatus: 'NONE', canInvite: true,
      email: 'guardian@example.test', students: [{ id: 'student-1', name: 'Aluno um' }],
    });
    expect(responsibleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'school-a', alunos: { some: { contaId: 'school-a' } } }),
      select: expect.objectContaining({ id: true, nome: true, email: true, usuario: expect.any(Object) }),
      skip: 5, take: 6,
    }));
    const select = responsibleFindMany.mock.calls[0][0]?.select as Record<string, unknown>;
    expect(select).not.toHaveProperty('cpf');
  });

  it('includes linked responsible records without email as null and keeps only id/name student summaries', async () => {
    vi.spyOn(prisma.responsavel, 'findMany').mockResolvedValue([{
      id: 'guardian-no-email', nome: 'Responsible', email: '   ', usuario: { status: 'ATIVO', acessosConta: [] },
      alunos: [{ alunoId: 'student-a', aluno: { id: 'student-a', nome: 'Aluno A', contaId: 'school-a' } }],
    }] as never);
    vi.spyOn(prisma.invite, 'findMany').mockResolvedValue([] as never);

    const result = await findInviteCandidatesInConta({ contaId: 'school-a', recordType: 'RESPONSAVEL', page: 1, limit: 10 });
    expect(result.items).toEqual([expect.objectContaining({
      recordId: 'guardian-no-email', email: null, students: [{ id: 'student-a', name: 'Aluno A' }], canInvite: true,
    })]);
  });

  it('marks globally inactive identities suspended and omits collaborator profiles with blank email', async () => {
    const collaboratorFindMany = vi.spyOn(prisma.colaborador, 'findMany').mockResolvedValue([
      { id: 'inactive-employee', nome: 'Inactive', email: 'inactive@example.test', usuario: { status: 'INATIVO', acessosConta: [{ status: 'ATIVO' }] } },
      { id: 'blank-employee', nome: 'No email', email: '   ', usuario: null },
    ] as never);
    vi.spyOn(prisma.invite, 'findMany').mockResolvedValue([] as never);

    const result = await findInviteCandidatesInConta({ contaId: 'school-a', recordType: 'COLABORADOR', page: 1, limit: 10 });
    expect(result.items).toEqual([
      expect.objectContaining({ recordId: 'inactive-employee', accessStatus: 'SUSPENDED', canInvite: false, students: [] }),
      expect.objectContaining({ recordId: 'blank-employee', email: null, canInvite: false }),
    ]);
    expect(result.hasMore).toBe(false);
    expect(collaboratorFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 11 }));
  });

  it('keeps email-less collaborators in pagination so following valid records are not skipped', async () => {
    const findMany = vi.spyOn(prisma.colaborador, 'findMany').mockImplementation((args) => {
      const skip = args?.skip ?? 0;
      const rows = [
        { id: 'blank-first', nome: 'No email', email: '   ', usuario: null },
        { id: 'valid-second', nome: 'Has email', email: 'valid@example.test', usuario: { status: 'ATIVO', acessosConta: [] } },
      ];
      return Promise.resolve(rows.slice(skip, skip + (args?.take ?? 2))) as never;
    });
    vi.spyOn(prisma.invite, 'findMany').mockResolvedValue([] as never);

    const firstPage = await findInviteCandidatesInConta({ contaId: 'school-a', recordType: 'COLABORADOR', page: 1, limit: 1 });
    const secondPage = await findInviteCandidatesInConta({ contaId: 'school-a', recordType: 'COLABORADOR', page: 2, limit: 1 });

    expect(firstPage).toMatchObject({ hasMore: true, items: [{ recordId: 'blank-first', email: null, canInvite: false }] });
    expect(secondPage).toMatchObject({ hasMore: false, items: [{ recordId: 'valid-second', email: 'valid@example.test', canInvite: true }] });
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ skip: 0, take: 2 }));
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 1, take: 2 }));
  });

  it('resolves an existing responsible and derives linked student IDs from the authenticated Conta', async () => {
    const responsibleFindFirst = vi.spyOn(prisma.responsavel, 'findFirst').mockResolvedValue({
      id: 'responsavel-a', nome: 'Responsável A', email: 'guardian@example.test',
      usuario: { status: 'ATIVO', acessosConta: [{ status: 'INATIVO' }] },
      alunos: [{ alunoId: 'student-a', aluno: { contaId: 'school-a' } }, { alunoId: 'student-b', aluno: { contaId: 'school-a' } }],
    } as never);

    await expect(findInviteTargetInConta('school-a', {
      recordType: 'RESPONSAVEL', recordId: 'responsavel-a',
    })).resolves.toMatchObject({
      recordType: 'RESPONSAVEL', recordId: 'responsavel-a', accessStatus: 'SUSPENDED',
      alunosIds: ['student-a', 'student-b'],
    });
    expect(responsibleFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'responsavel-a', contaId: 'school-a' }),
      select: expect.objectContaining({
        alunos: {
          where: { contaId: 'school-a' },
          select: { alunoId: true, aluno: { select: { contaId: true } } },
          orderBy: { alunoId: 'asc' },
        },
      }),
    }));
  });
});

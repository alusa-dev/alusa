import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@alusa/lib';
import {
  createFirstUser,
  EmailInUseError,
  InactiveAccountEmailError,
  CpfCnpjInUseError,
  PasswordPolicyError,
} from '@/lib/first-user-service';
import { resetDb } from '../utils/reset-db';

// Só executa estes testes com DB Postgres disponível
const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');
const describeIf = hasDb ? describe : describe.skip;

describeIf('createFirstUser', () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  const base = {
    escolaNome: 'Escola X',
    cpfCnpj: '52998224725',
    nome: 'Admin',
    email: 'admin@example.com',
    birthDate: '1990-01-01',
    senha: 'SenhaFort3!',
  };

  it('cria primeiro usuário ADMIN', async () => {
    interface UserShape {
      email: string;
      role: string;
    }
    const u = (await createFirstUser(base)) as unknown as UserShape;
    expect(u.email).toBe(base.email);
    expect(u.role).toBe('ADMIN');
    expect(await prisma.hubSpotAccountCreatedOutbox.count({ where: { conta: { is: { usuarios: { some: { email: base.email } } } } } })).toBe(0);
  });

  it('permite criar acesso de proprietário separado para e-mail já usado por um colaborador', async () => {
    const contaColaborador = await prisma.conta.create({ data: { nome: 'Escola do convite' }, select: { id: true } });
    const collaborator = await prisma.usuario.create({
      data: {
        contaId: contaColaborador.id,
        nome: 'João Colaborador',
        email: 'joao.contexto@example.com',
        senhaHash: 'legacy-hash',
        role: 'RECEPCAO',
        status: 'ATIVO',
      },
      select: { id: true },
    });
    await prisma.usuarioConta.create({
      data: { usuarioId: collaborator.id, contaId: contaColaborador.id, role: 'RECEPCAO', status: 'ATIVO' },
    });
    await prisma.authCredential.create({
      data: {
        context: 'COLLABORATOR',
        normalizedEmail: 'joao.contexto@example.com',
        userId: collaborator.id,
        passwordHash: 'collaborator-password-hash',
        emailVerifiedAt: new Date(),
      },
    });

    const owner = await createFirstUser({
      escolaNome: 'Nova escola do João',
      nome: 'João Proprietário',
      email: 'joao.contexto@example.com',
      senha: 'SenhaFort3!',
    });

    expect(owner.id).toBe(collaborator.id);
    expect(owner.contaId).not.toBe(contaColaborador.id);
    expect(await prisma.conta.findUnique({ where: { id: owner.contaId }, select: { ownerUserId: true, nome: true } }))
      .toEqual({ ownerUserId: collaborator.id, nome: 'Nova escola do João' });
    expect(await prisma.usuario.count({ where: { email: 'joao.contexto@example.com' } })).toBe(1);
    const credentials = await prisma.authCredential.findMany({ where: { userId: collaborator.id } });
    expect(credentials.map((credential) => credential.context)).toEqual(expect.arrayContaining(['OWNER', 'COLLABORATOR']));
    expect(credentials.find((credential) => credential.context === 'OWNER')?.passwordHash)
      .not.toBe(credentials.find((credential) => credential.context === 'COLLABORATOR')?.passwordHash);
  });

  it('enfileira uma notificação de conta criada apenas para cadastro self-service público', async () => {
    const user = await createFirstUser({ ...base, email: 'public-signup@example.com', registrationSource: 'PUBLIC_SELF_SERVICE' });
    const events = await prisma.hubSpotAccountCreatedOutbox.findMany({ where: { contaId: user.contaId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ contaId: user.contaId, status: 'PENDING', attempts: 0 });
    expect(events[0]?.availableAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('rolls back the public outbox row when a later registration write fails', async () => {
    const email = 'public-signup-rollback@example.com';
    const schoolName = 'Public Signup Rollback';
    await expect(createFirstUser({
      ...base,
      email,
      escolaNome: schoolName,
      registrationSource: 'PUBLIC_SELF_SERVICE',
      legalAcceptance: {
        accepted: true,
        documents: [{ documentType: 'TERMS_OF_USE', documentVersion: null as never }],
      },
    })).rejects.toThrow();
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
    expect(await prisma.hubSpotAccountCreatedOutbox.count({ where: { conta: { is: { nome: schoolName } } } })).toBe(0);
  });

  it('falha senha fraca', async () => {
    await expect(
      createFirstUser({ ...base, email: 'a2@example.com', senha: 'fraca' }),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
  });

  it('falha email duplicado', async () => {
    await createFirstUser(base);
    await expect(
      createFirstUser({ ...base, email: 'admin@example.com', cpfCnpj: '11144477735' }),
    ).rejects.toBeInstanceOf(EmailInUseError);
  });

  it('falha com conta desativada quando o email já pertence a uma conta encerrada', async () => {
    await createFirstUser(base);
    const existente = await prisma.usuario.findUnique({
      where: { email: base.email },
      select: { contaId: true },
    });
    expect(existente?.contaId).toBeTruthy();

    await prisma.conta.update({
      where: { id: existente!.contaId },
      data: {
        status: 'INATIVO',
        deletedAt: new Date('2026-04-28T00:00:00.000Z'),
      },
    });

    await expect(
      createFirstUser({ ...base, email: 'admin@example.com', cpfCnpj: '11144477735' }),
    ).rejects.toBeInstanceOf(InactiveAccountEmailError);
  });

  it('falha cpfCnpj duplicado', async () => {
    await createFirstUser(base);
    await expect(createFirstUser({ ...base, email: 'outro@example.com' })).rejects.toBeInstanceOf(
      CpfCnpjInUseError,
    );
  });
});

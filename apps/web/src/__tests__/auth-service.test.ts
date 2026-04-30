import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@alusa/lib';
import { verifyCredentials, verifyCredentialsDetailed } from '@/lib/auth-service';
import { createFirstUser } from '@/lib/first-user-service';
import { resetDb } from '../../tests/utils/reset-db';

// Só roda estes testes se houver DATABASE_URL real (Postgres),
// evitando falhas quando Prisma está configurado para Data Proxy ou sem DB local.
const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');
const describeIf = hasDb ? describe : describe.skip;

describeIf('verifyCredentials', () => {
  const email = 'test@example.com';
  const senha = 'SenhaFort3!';
    beforeAll(async () => {
      await resetDb(prisma);
      // Cria conta e usuário inicial (owner) usando o serviço oficial
      await createFirstUser({ escolaNome: 'Conta Teste', cpfCnpj: '11144477735', nome: 'Teste', email, birthDate: '1990-01-01', senha });
    });
  afterAll(async () => { await prisma.usuario.deleteMany({ where: { email } }); });
  it('retorna usuário válido com credenciais corretas', async () => {
    const res = await verifyCredentials(email, senha);
    expect(res?.email).toBe(email);
    expect(res?.role).toBe('ADMIN');
  });
  it('retorna null para senha incorreta', async () => {
    const res = await verifyCredentials(email, 'errada');
    expect(res).toBeNull();
  });
  it('retorna motivo INVALID_PASSWORD para senha incorreta', async () => {
    const res = await verifyCredentialsDetailed(email, 'errada');
    expect(res).toEqual({ ok: false, reason: 'INVALID_PASSWORD' });
  });
  it('retorna motivo USER_NOT_FOUND para usuário inexistente', async () => {
    const res = await verifyCredentialsDetailed('nao-existe@example.com', senha);
    expect(res).toEqual({ ok: false, reason: 'USER_NOT_FOUND' });
  });
});
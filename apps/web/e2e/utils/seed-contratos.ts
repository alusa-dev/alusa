import { Prisma, type PrismaClient } from '@prisma/client';

const TEST_PDF_DATA_URL =
  'data:application/pdf;base64,JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNCAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKMyAwIG9iago8PAovUHJvZHVjZXIgPEZFRkYwMDcwMDA2NDAwNjYwMDJEMDA2QzAwNjkwMDYyMDAyMDAwMjgwMDY4MDA3NDAwNzQwMDcwMDA3MzAwM0EwMDJGMDAyRjAwNjcwMDY5MDA3NDAwNjgwMDc1MDA2MjAwMkUwMDYzMDA2RjAwNkQwMDJGMDA0ODAwNkYwMDcwMDA2NDAwMDY5MDA2NTAwNjcwMDJGMDA3MDAwNjQwMDY2MDA2QzAwNjkwMDYyMDAyOT4KL01vZERhdGUgKEQ6MjAyNjA5MDUwMjIxNTVaKQovQ3JlYXRvciA8RkVGRjAwNzAwMDY0MDA2NjAwMkQwMDZDMDA2OTAwNjIwMDIwMDAyODAwNjgwMDc0MDA3NDAwNzAwMDczMDAzQTAwMkYwMDJGMDA2NzAwNjkwMDc0MDA2ODAwNzUwMDYyMDAyRTAwNjMwMDZGMDA2RDAwMkYwMDQ4MDA2RjAwNzAwMDY0MDA2OTAwNkUwMDY3MDAyRjAwNzAwMDY0MDA2NjAwMkQwMDZDMDA2OTAwNjIwMDI5PgovQ3JlYXRpb25EYXRlIChEOjIwMjYwOTA1MDIyMTU1WikKPj4KZW5kb2JqCgo0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgMSAwIFIKL1Jlc291cmNlcyA8PAo+PgovTWVkaWFCb3ggWyAwIDAgNTk1IDg0MiBdCj4+CmVuZG9iagoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE2IDAwMDAwIG4gCjAwMDAwMDAwNzYgMDAwMDAgbiAKMDAwMDAwMDEyNiAwMDAwMCBuIAowMDAwMDAwNTk2IDAwMDAwIG4gCgp0cmFpbGVyCjw8Ci9TaXplIDUKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKPj4KCnN0YXJ0eHJlZgo2ODcKJSVFT0Y=';
const DEFAULT_STUDENT_CPF = '52998224725';
const DEFAULT_RESPONSIBLE_CPF = '11144477735';

export type SeedContratoPublicoResult = {
  contaId: string;
  alunoId: string;
  matriculaId: string;
  contratoId: string;
  alunoCpfDigits: string;
  alunoEmail: string;
  responsavelCpfDigits?: string;
  responsavelEmail?: string;
  token: string;
};

export async function seedContratoPublico(
  prisma: PrismaClient,
  input?: {
    status?: 'PENDENTE' | 'ASSINADO' | 'EXPIRADO' | 'CANCELADO';
    token?: string;
    tokenExpiraEm?: Date | null;
    alunoCpfDigits?: string;
    responsavelCpfDigits?: string;
    alunoDataNasc?: Date;
    withResponsavelFinanceiro?: boolean;
  },
): Promise<SeedContratoPublicoResult> {
  const now = Date.now();
  const token = input?.token ?? `token-contrato-${now}`;

  const withResponsavelFinanceiro = input?.withResponsavelFinanceiro ?? true;

  const alunoCpfDigits = input?.alunoCpfDigits ?? DEFAULT_STUDENT_CPF;
  const responsavelCpfDigits = input?.responsavelCpfDigits ?? DEFAULT_RESPONSIBLE_CPF;

  const conta = await prisma.conta.create({
    data: {
      nome: `Conta E2E ${now}`,
      cpfCnpj: `cnpj-${now}`,
    },
    select: { id: true },
  });

  const aluno = await prisma.aluno.create({
    data: {
      contaId: conta.id,
      nome: 'Aluno E2E',
      dataNasc: input?.alunoDataNasc ?? new Date('2010-01-01T00:00:00.000Z'),
      cpf: alunoCpfDigits,
      email: `aluno-${now}@e2e.local`,
    },
    select: { id: true },
  });

  const responsavel = withResponsavelFinanceiro
    ? await prisma.responsavel.create({
        data: {
          contaId: conta.id,
          nome: 'Responsável E2E',
          cpf: responsavelCpfDigits,
          email: `resp-${now}@e2e.local`,
          telefone: '11999990000',
          financeiro: true,
        },
        select: { id: true },
      })
    : null;

  const modelo = await prisma.contratoModelo.create({
    data: {
      contaId: conta.id,
      nome: `Modelo E2E ${now}`,
      arquivoPdfUrl: TEST_PDF_DATA_URL,
      hashSha256: `hash-${now}`,
      versao: 1,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const matricula = await prisma.matricula.create({
    data: {
      contaId: conta.id,
      alunoId: aluno.id,
      responsavelFinanceiroId: responsavel?.id ?? null,
      planoId: null,
      turmaId: null,
      comboId: null,
      dataInicio: new Date('2025-01-01T00:00:00.000Z'),
      dataFimContrato: new Date('2026-01-01T00:00:00.000Z'),
      taxaMatricula: new Prisma.Decimal(0),
      taxaIsenta: true,
      vencimentoDia: 5,
      statusContrato: 'AGUARDANDO_ASSINATURA',
    },
    select: { id: true },
  });

  const contrato = await prisma.contrato.create({
    data: {
      contaId: conta.id,
      matriculaId: matricula.id,
      modeloId: modelo.id,
      arquivoPdfUrl: TEST_PDF_DATA_URL,
      hashPdf: `hash-contrato-${now}`,
      status: input?.status ?? 'PENDENTE',
      tokenPublico: token,
      tokenExpiraEm: input?.tokenExpiraEm ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      assinadoPor: input?.status === 'ASSINADO' ? (withResponsavelFinanceiro ? 'Responsável E2E' : 'Aluno E2E') : null,
      assinadoCpf: input?.status === 'ASSINADO' ? (withResponsavelFinanceiro ? responsavelCpfDigits : alunoCpfDigits) : null,
      assinadoEm: input?.status === 'ASSINADO' ? new Date() : null,
    },
    select: { id: true },
  });

  return {
    contaId: conta.id,
    alunoId: aluno.id,
    matriculaId: matricula.id,
    contratoId: contrato.id,
    alunoCpfDigits,
    alunoEmail: `aluno-${now}@e2e.local`,
    responsavelCpfDigits: withResponsavelFinanceiro ? responsavelCpfDigits : undefined,
    responsavelEmail: withResponsavelFinanceiro ? `resp-${now}@e2e.local` : undefined,
    token,
  };
}

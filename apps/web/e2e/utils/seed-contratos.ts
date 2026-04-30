import { Prisma, type PrismaClient } from '@prisma/client';

let seedCounter = 0;

function toCpfDigits(value: number): string {
  const digits = String(Math.abs(value)).replace(/\D/g, '');
  return digits.padStart(11, '0').slice(-11);
}

export type SeedContratoPublicoResult = {
  contaId: string;
  alunoId: string;
  matriculaId: string;
  contratoId: string;
  alunoCpfDigits: string;
  responsavelCpfDigits?: string;
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
  const unique = now + seedCounter++;
  const token = input?.token ?? `token-contrato-${now}`;

  const withResponsavelFinanceiro = input?.withResponsavelFinanceiro ?? true;

  const alunoCpfDigits = input?.alunoCpfDigits ?? toCpfDigits(unique);
  const responsavelCpfDigits = input?.responsavelCpfDigits ?? toCpfDigits(unique + 12345);

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
      dataNasc: input?.alunoDataNasc ?? new Date('2000-01-01T00:00:00.000Z'),
      cpf: alunoCpfDigits,
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
      arquivoUrl: 'https://example.com/test.pdf',
      hashPdf: `hash-${now}`,
      versao: 1,
      ativo: true,
    },
    select: { id: true },
  });

  const matricula = await prisma.matricula.create({
    data: {
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
      matriculaId: matricula.id,
      modeloId: modelo.id,
      arquivoPdfUrl: 'https://example.com/contrato.pdf',
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
    responsavelCpfDigits: withResponsavelFinanceiro ? responsavelCpfDigits : undefined,
    token,
  };
}

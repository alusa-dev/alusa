import {
  CONTRACT_ACCEPTANCE_TEXT_V1,
  CONTRACT_ACCEPTANCE_VERSION,
} from '@alusa/domain';
import {
  alunoContratoCardDTOSchema,
  contratoDTOSchema,
  contratoModeloDTOSchema,
  contratoPublicoDTOSchema,
  type ContratoSubscriptionSyncDTO,
} from './dtos';

type Nullable<T> = T | null | undefined;

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapContratoRecordToDTO(
  contrato: Record<string, unknown>,
  extras?: { subscriptionSync?: ContratoSubscriptionSyncDTO | null; publicToken?: string | null },
) {
  const modelo = (contrato.modelo as Nullable<Record<string, unknown>>) ?? null;
  const matricula = (contrato.matricula as Nullable<Record<string, unknown>>) ?? {};
  const aluno = (matricula.aluno as Nullable<Record<string, unknown>>) ?? {};
  const turma = (matricula.turma as Nullable<Record<string, unknown>>) ?? null;
  const storedPublicToken = contrato.tokenPublico ? String(contrato.tokenPublico) : '';
  const dtoPublicToken =
    extras?.publicToken ?? (storedPublicToken.startsWith('hash:') ? '' : storedPublicToken);

  return contratoDTOSchema.parse({
    id: String(contrato.id ?? ''),
    matriculaId: String(contrato.matriculaId ?? ''),
    modeloId: contrato.modeloId ? String(contrato.modeloId) : null,
    contratoOrigemId: contrato.contratoOrigemId ? String(contrato.contratoOrigemId) : null,
    arquivoPdfUrl: String(contrato.arquivoPdfUrl ?? ''),
    hashPdf: String(contrato.hashPdf ?? ''),
    arquivoPdfAssinadoUrl: contrato.arquivoPdfAssinadoUrl ? String(contrato.arquivoPdfAssinadoUrl) : null,
    hashPdfAssinado: contrato.hashPdfAssinado ? String(contrato.hashPdfAssinado) : null,
    status: contrato.status,
    assinadoPor: contrato.assinadoPor ? String(contrato.assinadoPor) : null,
    assinadoEmail: contrato.assinadoEmail ? String(contrato.assinadoEmail) : null,
    assinadoCpf: contrato.assinadoCpf ? String(contrato.assinadoCpf) : null,
    assinadoIp: contrato.assinadoIp ? String(contrato.assinadoIp) : null,
    assinadoEm: toIsoString(contrato.assinadoEm as Nullable<Date | string>),
    assinadoUserAgent: contrato.assinadoUserAgent ? String(contrato.assinadoUserAgent) : null,
    hashAssinatura: contrato.hashAssinatura ? String(contrato.hashAssinatura) : null,
    tokenPublico: dtoPublicToken,
    tokenExpiraEm: toIsoString(contrato.tokenExpiraEm as Nullable<Date | string>),
    createdAt: toIsoString(contrato.createdAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    updatedAt: toIsoString(contrato.updatedAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    modelo: modelo
      ? {
          id: modelo.id ? String(modelo.id) : null,
          nome: String(modelo.nome ?? ''),
        }
      : null,
    matricula: {
      id: String(matricula.id ?? ''),
      contratoAtualId: matricula.contratoAtualId ? String(matricula.contratoAtualId) : null,
      aluno: {
        id: aluno.id ? String(aluno.id) : null,
        nome: String(aluno.nome ?? ''),
        cpf: aluno.cpf ? String(aluno.cpf) : null,
      },
      turma: turma
        ? {
            id: turma.id ? String(turma.id) : null,
            nome: String(turma.nome ?? ''),
          }
        : null,
    },
    subscriptionSync: extras?.subscriptionSync ?? null,
  });
}

export function mapContratoModeloRecordToDTO(modelo: Record<string, unknown>) {
  const count = (modelo._count as Nullable<Record<string, unknown>>) ?? null;

  return contratoModeloDTOSchema.parse({
    id: String(modelo.id ?? ''),
    contaId: String(modelo.contaId ?? ''),
    nome: String(modelo.nome ?? ''),
    descricao: modelo.descricao ? String(modelo.descricao) : null,
    arquivoOriginalUrl: modelo.arquivoOriginalUrl ? String(modelo.arquivoOriginalUrl) : null,
    arquivoPdfUrl: String(modelo.arquivoPdfUrl ?? ''),
    mimeType: String(modelo.mimeType ?? ''),
    hashSha256: String(modelo.hashSha256 ?? ''),
    tamanhoBytes:
      typeof modelo.tamanhoBytes === 'number' ? modelo.tamanhoBytes : modelo.tamanhoBytes ?? null,
    versao: Number(modelo.versao ?? 1),
    status: modelo.status,
    createdAt: toIsoString(modelo.createdAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    updatedAt: toIsoString(modelo.updatedAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    _count: count
      ? {
          contratos: Number(count.contratos ?? 0),
        }
      : undefined,
  });
}

export function mapAlunoContratoCardToDTO(aluno: Record<string, unknown>) {
  return alunoContratoCardDTOSchema.parse({
    id: String(aluno.id ?? ''),
    nome: String(aluno.nome ?? ''),
    foto: aluno.foto ? String(aluno.foto) : null,
  });
}

export function mapPublicContratoRecordToDTO(contrato: Record<string, unknown>) {
  const matricula = (contrato.matricula as Nullable<Record<string, unknown>>) ?? {};
  const aluno = (matricula.aluno as Nullable<Record<string, unknown>>) ?? {};
  const responsavel = (matricula.responsavelFinanceiro as Nullable<Record<string, unknown>>) ?? null;

  return contratoPublicoDTOSchema.parse({
    id: String(contrato.id ?? ''),
    arquivoPdfUrl: String(contrato.arquivoPdfUrl ?? ''),
    hashPdf: String(contrato.hashPdf ?? ''),
    status: contrato.status,
    tokenExpiraEm: toIsoString(contrato.tokenExpiraEm as Nullable<Date | string>),
    acceptanceText: CONTRACT_ACCEPTANCE_TEXT_V1,
    acceptanceVersion: CONTRACT_ACCEPTANCE_VERSION,
    matricula: {
      aluno: {
        nome: String(aluno.nome ?? ''),
      },
      responsavelFinanceiro: responsavel
        ? {
            nome: String(responsavel.nome ?? ''),
          }
        : null,
    },
  });
}

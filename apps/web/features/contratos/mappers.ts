import {
  CONTRACT_ACCEPTANCE_TEXT_V1,
  CONTRACT_ACCEPTANCE_VERSION,
  isMaiorDeIdade,
  renderContractConsentTemplate,
  type ContractConsentRenderContext,
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
    campos: Array.isArray(modelo.campos)
      ? modelo.campos.map((campo) => {
          const item = campo as Record<string, unknown>;
          return {
            id: String(item.id ?? ''),
            tipo: item.tipo,
            papel: item.papel,
            pagina: Number(item.pagina ?? 1),
            x: Number(item.x ?? 0),
            y: Number(item.y ?? 0),
            largura: Number(item.largura ?? 0.22),
            altura: Number(item.altura ?? 0.08),
            obrigatorio: Boolean(item.obrigatorio ?? true),
            ordem: Number(item.ordem ?? 0),
          };
        })
      : [],
    consentimentos: Array.isArray(modelo.consentimentos)
      ? modelo.consentimentos.map((consentimento) => {
          const item = consentimento as Record<string, unknown>;
          return {
            id: String(item.id ?? ''),
            codigo: String(item.codigo ?? ''),
            templateId: item.templateId ? String(item.templateId) : null,
            templateVersao: item.templateVersao == null ? null : Number(item.templateVersao),
            finalidade: item.finalidade,
            titulo: String(item.titulo ?? ''),
            texto: String(item.texto ?? ''),
            papel: item.papel,
            obrigatorio: Boolean(item.obrigatorio ?? true),
            recusaImpedeAssinatura: Boolean(item.recusaImpedeAssinatura ?? false),
            ordem: Number(item.ordem ?? 0),
          };
        })
      : [],
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
  const linkedResponsaveis = Array.isArray(aluno.responsaveis) ? aluno.responsaveis as Array<Record<string, unknown>> : [];
  const linkedResponsavel = (linkedResponsaveis[0]?.responsavel as Nullable<Record<string, unknown>>) ?? null;
  const alunoMaior = aluno.dataNasc ? isMaiorDeIdade(aluno.dataNasc as Date | string) : false;
  const conta = (contrato.conta as Nullable<Record<string, unknown>>) ?? {};

  const snapshot = Array.isArray(contrato.camposAssinaturaSnapshot)
    ? contrato.camposAssinaturaSnapshot
    : null;
  const modelFields = Array.isArray((contrato.modelo as Record<string, unknown> | null)?.campos)
    ? ((contrato.modelo as Record<string, unknown>).campos as Array<Record<string, unknown>>)
    : [];
  const fields = snapshot ?? modelFields;
  const consentimentos = (Array.isArray(contrato.termosConsentimentoSnapshot)
    ? contrato.termosConsentimentoSnapshot
    : Array.isArray((contrato.modelo as Record<string, unknown> | null)?.consentimentos)
      ? (contrato.modelo as Record<string, unknown>).consentimentos
      : []) as Array<Record<string, unknown>>;
  const signerContext: ContractConsentRenderContext = alunoMaior
    ? {
        signerType: 'ALUNO_MAIOR',
        signerName: String(aluno.nome ?? ''),
        signerCpf: null,
        studentName: String(aluno.nome ?? ''),
        studentCpf: null,
        relationship: null,
      }
    : {
        signerType: 'RESPONSAVEL',
        signerName: String(responsavel?.nome ?? linkedResponsavel?.nome ?? 'responsável legal'),
        signerCpf: null,
        studentName: String(aluno.nome ?? ''),
        studentCpf: null,
        relationship: 'responsável legal',
      };
  const renderedConsentimentos = consentimentos.map((item) => {
    return {
      ...item,
      texto: renderContractConsentTemplate(String(item.texto ?? ''), signerContext),
    };
  });

  return contratoPublicoDTOSchema.parse({
    id: String(contrato.id ?? ''),
    arquivoPdfUrl: String(contrato.arquivoPdfUrl ?? ''),
    hashPdf: String(contrato.hashPdf ?? ''),
    status: contrato.status,
    tokenExpiraEm: toIsoString(contrato.tokenExpiraEm as Nullable<Date | string>),
    acceptanceText: CONTRACT_ACCEPTANCE_TEXT_V1,
    acceptanceVersion: CONTRACT_ACCEPTANCE_VERSION,
    consentimentos: renderedConsentimentos,
    escolaNome: String(conta.nome ?? ''),
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
    signatario: alunoMaior
      ? { nome: String(aluno.nome ?? ''), tipo: 'ALUNO_MAIOR' }
      : { nome: String(responsavel?.nome ?? linkedResponsavel?.nome ?? ''), tipo: 'RESPONSAVEL' },
    camposAssinatura: fields.map((campo) => {
      const item = campo as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        tipo: item.tipo,
        papel: item.papel,
        pagina: Number(item.pagina ?? 1),
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        largura: Number(item.largura ?? 0),
        altura: Number(item.altura ?? 0),
        obrigatorio: Boolean(item.obrigatorio),
        ordem: Number(item.ordem ?? 0),
      };
    }),
  });
}

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma as shared } from '../prisma';
import type { AlunoCreateInput, AlunoUpdateInput } from './aluno.schema';
import { calcIdade } from './aluno.schema';
import {
  digits,
  nullifyEmpty,
  flattenAlunoEndereco,
  flattenResponsavelEndereco,
} from './map-flatten';
import {
  ensureAsaasCustomerForPayer,
  AsaasCustomerEnsureError,
  type EnsureAsaasCustomerPayer,
  loadAndValidateSubaccountKey,
} from '../services/asaas/ensure-asaas-customer';
import { deleteCustomer as deleteAsaasCustomer } from '@alusa/asaas';
import { executeAlunoArchivePolicy, type AlunoArchiveResult } from './policies';

const prisma: PrismaClient = shared as unknown as PrismaClient;

// ─────────────────────────────────────────────────────────────────────────────
// Customer Inactivation Safety Check
// ─────────────────────────────────────────────────────────────────────────────

type CustomerInactivationCheckResult = {
  canInactivate: boolean;
  reason: 'SAFE_TO_INACTIVATE' | 'SHARED_WITH_ACTIVE_ALUNOS' | 'NO_CUSTOMER_ID' | 'SHARED_WITH_ACTIVE_MATRICULAS';
  sharedWith?: {
    alunos: number;
    matriculas: number;
  };
};

/**
 * Verifica se um customer Asaas pode ser inativado com segurança.
 * 
 * REGRA: Customer pode ser compartilhado entre múltiplos alunos (ex.: pai de 3 filhos)
 * Só inativar se não houver outros alunos/matrículas ativos usando o mesmo customer.
 */
async function canInactivateAsaasCustomer(params: {
  asaasCustomerId: string;
  contaId: string;
  excludeAlunoId?: string;
}): Promise<CustomerInactivationCheckResult> {
  const { asaasCustomerId, contaId, excludeAlunoId } = params;

  if (!asaasCustomerId) {
    return { canInactivate: false, reason: 'NO_CUSTOMER_ID' };
  }

  // Buscar alunos ativos que usam este customer (diretamente ou via responsável)
  const [alunosWithSameCustomer, responsaveisWithSameCustomer] = await Promise.all([
    // Alunos maiores de idade que têm este asaasCustomerId
    prisma.aluno.count({
      where: {
        contaId,
        asaasCustomerId,
        status: 'ATIVO',
        ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
      },
    }),
    // Responsáveis com este asaasCustomerId vinculados a alunos ativos
    prisma.responsavel.count({
      where: {
        asaasCustomerId,
        alunos: {
          some: {
            aluno: {
              contaId,
              status: 'ATIVO',
              ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
            },
          },
        },
      },
    }),
  ]);

  const totalActiveAlunos = alunosWithSameCustomer + responsaveisWithSameCustomer;

  if (totalActiveAlunos > 0) {
    // Buscar matrículas ativas para auditoria
    const activeMatriculas = await prisma.matricula.count({
      where: {
        status: { in: ['ATIVA', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'PENDENTE_TAXA'] },
        aluno: {
          contaId,
          status: 'ATIVO',
          ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
          OR: [
            { asaasCustomerId },
            {
              responsaveis: {
                some: {
                  responsavel: { asaasCustomerId },
                },
              },
            },
          ],
        },
      },
    });

    return {
      canInactivate: false,
      reason: activeMatriculas > 0 ? 'SHARED_WITH_ACTIVE_MATRICULAS' : 'SHARED_WITH_ACTIVE_ALUNOS',
      sharedWith: {
        alunos: totalActiveAlunos,
        matriculas: activeMatriculas,
      },
    };
  }

  return { canInactivate: true, reason: 'SAFE_TO_INACTIVATE' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aluno Deletion Types and Helpers
// ─────────────────────────────────────────────────────────────────────────────

type AlunoDeletionSummary = {
  matriculas: number;
  inscricoesEvento: number;
  cobrancas: number;
  pagamentos: number;
  subscriptions: number;
  installmentPlans: number;
  contratos: number;
  customersAluno: number;
  customersResponsavel: number;
  webhooks: number;
  hasAsaasLink: boolean;
};

function buildExternalReference(contaId: string, type: 'aluno' | 'responsavel', id: string) {
  return `alusa_${contaId}_${type}_${id}`;
}

async function countWebhooksByExternalReferences(contaId: string, refs: string[]): Promise<number> {
  if (!refs.length) return 0;
  const patterns = refs.map((ref) => `%${ref}%`);
  const conditions = patterns.map((pattern) => Prisma.sql`"payload"::text ILIKE ${pattern}`);
  const whereClause = Prisma.join(conditions, ' OR ');

  const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint as count
    FROM "WebhookAsaas"
    WHERE "contaId" = ${contaId}
      AND (${whereClause})
  `);
  return Number(rows[0]?.count ?? 0);
}

async function getAlunoDeletionDependencies(aluno: {
  id: string;
  contaId: string;
  asaasCustomerId: string | null;
  asaasCustomerExternalReference: string | null;
  asaasId: string | null;
  responsaveis: Array<{
    responsavel: {
      id: string;
      asaasId: string | null;
      asaasCustomerId: string | null;
      asaasCustomerExternalReference: string | null;
    };
  }>;
}): Promise<{ canHardDelete: boolean; summary: AlunoDeletionSummary }> {
  const responsavelIds = aluno.responsaveis.map((item) => item.responsavel.id);
  const responsavelAsaasLink = aluno.responsaveis.some(
    (item) =>
      Boolean(item.responsavel.asaasCustomerId) ||
      Boolean(item.responsavel.asaasCustomerExternalReference) ||
      Boolean(item.responsavel.asaasId),
  );

  const refs = new Set<string>();
  refs.add(buildExternalReference(aluno.contaId, 'aluno', aluno.id));
  if (aluno.asaasCustomerExternalReference) refs.add(aluno.asaasCustomerExternalReference);
  for (const item of aluno.responsaveis) {
    refs.add(buildExternalReference(aluno.contaId, 'responsavel', item.responsavel.id));
    if (item.responsavel.asaasCustomerExternalReference) {
      refs.add(item.responsavel.asaasCustomerExternalReference);
    }
  }

  const [
    matriculas,
    inscricoesEvento,
    cobrancas,
    pagamentos,
    subscriptions,
    installmentPlans,
    contratos,
    customersAluno,
    customersResponsavel,
    webhooks,
  ] = await Promise.all([
    prisma.matricula.count({ where: { alunoId: aluno.id } }),
    prisma.portalEventoInscricao.count({ where: { alunoId: aluno.id } }),
    prisma.cobranca.count({ where: { matricula: { alunoId: aluno.id } } }),
    prisma.pagamento.count({ where: { cobranca: { matricula: { alunoId: aluno.id } } } }),
    prisma.subscription.count({ where: { matricula: { alunoId: aluno.id } } }),
    prisma.installmentPlan.count({ where: { matricula: { alunoId: aluno.id } } }),
    prisma.contrato.count({ where: { matricula: { alunoId: aluno.id } } }),
    prisma.customer.count({ where: { contaId: aluno.contaId, payerType: 'ALUNO', payerId: aluno.id } }),
    responsavelIds.length
      ? prisma.customer.count({
        where: { contaId: aluno.contaId, payerType: 'RESPONSAVEL', payerId: { in: responsavelIds } },
      })
      : 0,
    countWebhooksByExternalReferences(aluno.contaId, Array.from(refs)),
  ]);

  const hasAsaasLink =
    Boolean(aluno.asaasCustomerId) ||
    Boolean(aluno.asaasCustomerExternalReference) ||
    Boolean(aluno.asaasId) ||
    responsavelAsaasLink;

  const summary: AlunoDeletionSummary = {
    matriculas,
    inscricoesEvento,
    cobrancas,
    pagamentos,
    subscriptions,
    installmentPlans,
    contratos,
    customersAluno,
    customersResponsavel,
    webhooks,
    hasAsaasLink,
  };

  const canHardDelete =
    matriculas === 0 &&
    inscricoesEvento === 0 &&
    cobrancas === 0 &&
    pagamentos === 0 &&
    subscriptions === 0 &&
    installmentPlans === 0 &&
    contratos === 0 &&
    webhooks === 0;

  return { canHardDelete, summary };
}

export async function listAlunos(contaId: string) {
  return prisma.aluno.findMany({
    where: { contaId },
    orderBy: { createdAt: 'desc' },
    include: {
      responsaveis: {
        include: {
          responsavel: true,
        },
      },
    },
  });
}

type AlunoExtraFields = Partial<{
  nomeSocial: string;
  cpf: string;
  genero: 'MASCULINO' | 'FEMININO' | 'NAO_BINARIO' | 'OUTRO' | 'PREFERE_NAO_INFORMAR';
  modalidadePrincipal: string;
  nivel: string;
  alergias: string;
  restricoesMedicas: string;
  contatoEmergenciaNome: string;
  contatoEmergenciaTelefone: string;
  origemCadastro: string;
  bolsaDescontoPercent: number;
  isentoTaxaMatricula: boolean;
  consentimentoImagem: boolean;
  dataConsentimentoImagem: Date;
  consentimentoComunicacoes: boolean;
  tamanhoCamiseta: string;
  tamanhoCalcado: string;
  codigoInterno: string;
  tags: string[];
  foto: string;
}>;

export async function createAluno(data: AlunoCreateInput & AlunoExtraFields) {
  const idade = calcIdade(data.dataNasc);
  const isMenor = idade < 18;
  // Menor de 18: responsável é obrigatório e será o pagador
  // Maior de 18: aluno é o próprio pagador, responsável é opcional
  const responsavelObrigatorio = isMenor;

  // Normalizar dados de entrada
  // Aceitar casos onde endereco (ou responsavel.endereco) chegam como string JSON
  const enderecoObj = ((): AlunoCreateInput['endereco'] | undefined => {
    const val = (data as unknown as { endereco?: unknown }).endereco;
    if (!val) return undefined;
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        /* ignore parse error */ return undefined;
      }
    }
    return val as AlunoCreateInput['endereco'];
  })();
  const responsavelEnderecoObj = ((): AlunoCreateInput['endereco'] | undefined => {
    const r = (data as unknown as { responsavel?: { endereco?: unknown } }).responsavel;
    if (!r || typeof r !== 'object') return undefined;
    const val = r.endereco;
    if (!val) return undefined;
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        /* ignore */ return undefined;
      }
    }
    return val as AlunoCreateInput['endereco'];
  })();

  const normalizedData = {
    ...data,
    responsavelExistenteId: nullifyEmpty(data.responsavelExistenteId ?? undefined),
    cpf: digits(data.cpf),
    telefone: digits(data.telefone),
    contatoEmergenciaTelefone: digits(data.contatoEmergenciaTelefone),
    endereco: enderecoObj
      ? {
        ...enderecoObj,
        cep: digits(enderecoObj.cep),
      }
      : undefined,
    responsavel: data.responsavel
      ? {
        ...data.responsavel,
        cpf: digits(data.responsavel.cpf),
        telefone: digits(data.responsavel.telefone),
        endereco: responsavelEnderecoObj
          ? {
            ...responsavelEnderecoObj,
            cep: digits(responsavelEnderecoObj.cep),
          }
          : undefined,
      }
      : undefined,
  };

  console.log('🏗️ Criando aluno:', {
    nome: normalizedData.nome,
    cpf: normalizedData.cpf ? `${normalizedData.cpf.slice(0, 3)}***` : 'não informado',
    idade,
    temResponsavel: !!(
      isMenor && (normalizedData.responsavelExistenteId || normalizedData.responsavel?.cpf)
    ),
  });

  if (
    responsavelObrigatorio &&
    !normalizedData.responsavelExistenteId &&
    !normalizedData.responsavel
  ) {
    throw new AsaasCustomerEnsureError(
      'PAYER_INVALID',
      'Responsável financeiro obrigatório para sincronização do pagador.',
    );
  }

  const creation = await prisma.$transaction(async (tx) => {
    // 1. Verificar se a conta existe
    const conta = await tx.conta.findUnique({ where: { id: normalizedData.contaId } });
    if (!conta) {
      throw new Error(`Conta com ID ${normalizedData.contaId} não encontrada`);
    }

    // 2. Verificar duplicatas de CPF por conta se fornecido
    if (normalizedData.cpf) {
      const existingAluno = await tx.aluno.findUnique({
        where: { contaId_cpf: { contaId: normalizedData.contaId, cpf: normalizedData.cpf } },
      });
      if (existingAluno) {
        throw new Error(`Aluno com CPF ${normalizedData.cpf} já existe nesta conta`);
      }
    }

    // 3. Verificar duplicatas de email por conta se fornecido
    if (normalizedData.email) {
      const existingEmail = await tx.aluno.findUnique({
        where: { contaId_email: { contaId: normalizedData.contaId, email: normalizedData.email } },
      });
      if (existingEmail) {
        throw new Error(`Email ${normalizedData.email} já está em uso nesta conta`);
      }
    }

    // 4. Processar responsável se obrigatório
    let responsavelId: string | undefined;
    let createdResponsavelId: string | null = null;
    if (responsavelObrigatorio && normalizedData.responsavelExistenteId) {
      const existingById = await tx.responsavel.findFirst({
        where: {
          id: normalizedData.responsavelExistenteId,
          contaId: normalizedData.contaId,
        },
        select: { id: true },
      });

      if (!existingById) {
        throw new Error('Responsável selecionado não encontrado nesta conta');
      }

      responsavelId = existingById.id;
    } else if (responsavelObrigatorio && normalizedData.responsavel && normalizedData.responsavel.cpf) {
      const existing = await tx.responsavel.findFirst({
        where: { contaId: normalizedData.contaId, cpf: normalizedData.responsavel.cpf },
      });
      if (existing) {
        // Atualizar dados do responsável existente se necessário
        await tx.responsavel.update({
          where: { id: existing.id },
          data: {
            nome: normalizedData.responsavel.nome!,
            email: normalizedData.responsavel.email!,
            telefone: normalizedData.responsavel.telefone!,
            // Campos de endereço estruturados
            enderecoCep: normalizedData.responsavel.endereco?.cep || existing.enderecoCep,
            enderecoLogradouro:
              normalizedData.responsavel.endereco?.logradouro || existing.enderecoLogradouro,
            enderecoNumero: normalizedData.responsavel.endereco?.numero || existing.enderecoNumero,
            enderecoComplemento:
              normalizedData.responsavel.endereco?.complemento || existing.enderecoComplemento,
            enderecoBairro: normalizedData.responsavel.endereco?.bairro || existing.enderecoBairro,
            enderecoCidade: normalizedData.responsavel.endereco?.cidade || existing.enderecoCidade,
            enderecoUf: normalizedData.responsavel.endereco?.uf || existing.enderecoUf,
            financeiro: normalizedData.responsavel.financeiro ?? existing.financeiro,
          },
        });
        responsavelId = existing.id;
      } else {
        // Verificar se email do responsável já existe nesta conta
        if (normalizedData.responsavel.email) {
          const existingRespEmail = await tx.responsavel.findFirst({
            where: { contaId: normalizedData.contaId, email: normalizedData.responsavel.email },
          });
          if (existingRespEmail) {
            throw new Error(
              `Email do responsável ${normalizedData.responsavel.email} já está em uso nesta conta`,
            );
          }
        }

        const resp = await tx.responsavel.create({
          data: {
            contaId: normalizedData.contaId,
            nome: normalizedData.responsavel.nome!,
            cpf: normalizedData.responsavel.cpf!,
            email: normalizedData.responsavel.email!,
            telefone: normalizedData.responsavel.telefone!,
            // Campos de endereço estruturados
            enderecoCep: normalizedData.responsavel.endereco?.cep || undefined,
            enderecoLogradouro: normalizedData.responsavel.endereco?.logradouro || undefined,
            enderecoNumero: normalizedData.responsavel.endereco?.numero || undefined,
            enderecoComplemento: normalizedData.responsavel.endereco?.complemento || undefined,
            enderecoBairro: normalizedData.responsavel.endereco?.bairro || undefined,
            enderecoCidade: normalizedData.responsavel.endereco?.cidade || undefined,
            enderecoUf: normalizedData.responsavel.endereco?.uf || undefined,
            financeiro: normalizedData.responsavel.financeiro ?? true,
          },
        });
        responsavelId = resp.id;
        createdResponsavelId = resp.id;
      }
    }

    // 5. Gerar código interno sequencial se não fornecido
    let codigoInterno = normalizedData.codigoInterno;
    if (!codigoInterno) {
      const last = await tx.aluno.findFirst({
        where: { contaId: normalizedData.contaId, codigoInterno: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { codigoInterno: true },
      });
      const nextNumber = last?.codigoInterno
        ? parseInt(last.codigoInterno.replace(/\D/g, '')) + 1
        : 1;
      codigoInterno = String(nextNumber).padStart(5, '0');
    }

    // 6. Verificar se código interno já existe por conta
    if (codigoInterno) {
      const existingCodigo = await tx.aluno.findUnique({
        where: { contaId_codigoInterno: { contaId: normalizedData.contaId, codigoInterno } },
      });
      if (existingCodigo) {
        // Gerar novo código automaticamente
        const last = await tx.aluno.findFirst({
          where: { contaId: normalizedData.contaId, codigoInterno: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { codigoInterno: true },
        });
        const nextNumber = last?.codigoInterno
          ? parseInt(last.codigoInterno.replace(/\D/g, '')) + 1
          : 1;
        codigoInterno = String(nextNumber).padStart(5, '0');
      }
    }

    // 7. Preparar dados do aluno com defaults seguros
    const alunoData = {
      contaId: normalizedData.contaId,
      nome: normalizedData.nome.trim(),
      nomeSocial: nullifyEmpty(normalizedData.nomeSocial ?? undefined),
      dataNasc: normalizedData.dataNasc,
      cpf: normalizedData.cpf || undefined,
      email: normalizedData.email?.trim().toLowerCase() || undefined,
      telefone: normalizedData.telefone || undefined,
      asaasCustomerId: undefined,
      foto: nullifyEmpty(normalizedData.foto ?? undefined),
      // Endereço (flatten)
      ...flattenAlunoEndereco({ endereco: normalizedData.endereco ?? null }),
      observacao: nullifyEmpty(normalizedData.observacao ?? undefined),
      genero: normalizedData.genero || undefined,
      modalidadePrincipal: nullifyEmpty(normalizedData.modalidadePrincipal ?? undefined),
      nivel: nullifyEmpty(normalizedData.nivel ?? undefined),
      alergias: nullifyEmpty(normalizedData.alergias ?? undefined),
      restricoesMedicas: nullifyEmpty(normalizedData.restricoesMedicas ?? undefined),
      contatoEmergenciaNome: nullifyEmpty(normalizedData.contatoEmergenciaNome ?? undefined),
      contatoEmergenciaTelefone: normalizedData.contatoEmergenciaTelefone || undefined,
      origemCadastro: normalizedData.origemCadastro?.trim() || 'MANUAL',
      bolsaDescontoPercent: normalizedData.bolsaDescontoPercent || undefined,
      isentoTaxaMatricula: normalizedData.isentoTaxaMatricula ?? false,
      consentimentoImagem: normalizedData.consentimentoImagem ?? false,
      dataConsentimentoImagem: normalizedData.consentimentoImagem
        ? normalizedData.dataConsentimentoImagem || new Date()
        : undefined,
      consentimentoComunicacoes: normalizedData.consentimentoComunicacoes ?? true,
      tamanhoCamiseta: nullifyEmpty(normalizedData.tamanhoCamiseta ?? undefined),
      tamanhoCalcado: nullifyEmpty(normalizedData.tamanhoCalcado ?? undefined),
      codigoInterno,
      tags: normalizedData.tags || [],
      status: (normalizedData.status as 'ATIVO' | 'INATIVO') ?? 'ATIVO',
    };

    // 8. Criar o aluno
    const aluno = await tx.aluno.create({ data: alunoData });

    // 9. Vincular responsável se necessário
    if (responsavelId) {
      await tx.alunoResponsavel.create({
        data: { alunoId: aluno.id, responsavelId, tipoVinculo: 'PRINCIPAL' },
      });
      console.log('🔗 Responsável vinculado ao aluno');
    }

    console.log('✅ Aluno criado com sucesso:', {
      id: aluno.id,
      codigo: aluno.codigoInterno,
      nome: aluno.nome,
    });

    return { aluno, responsavelId, createdResponsavelId };
  });

  const { aluno, responsavelId, createdResponsavelId } = creation;

  const responsavelPayer = responsavelObrigatorio && responsavelId
    ? await prisma.responsavel.findFirst({
        where: { id: responsavelId, contaId: normalizedData.contaId },
        select: {
          id: true,
          nome: true,
          cpf: true,
          email: true,
          telefone: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          asaasCustomerId: true,
        },
      })
    : null;

  let payerForEnsure: EnsureAsaasCustomerPayer;
  if (responsavelObrigatorio) {
    if (!responsavelPayer) {
      throw new AsaasCustomerEnsureError(
        'PAYER_INVALID',
        'Responsável financeiro obrigatório para sincronização do pagador.',
      );
    }
    payerForEnsure = {
      type: 'RESPONSAVEL' as const,
      id: responsavelPayer.id,
      name: responsavelPayer.nome,
      cpfCnpj: responsavelPayer.cpf ?? '',
      email: responsavelPayer.email ?? undefined,
      phone: responsavelPayer.telefone ?? undefined,
      mobilePhone: responsavelPayer.telefone ?? undefined,
      address: responsavelPayer.enderecoLogradouro ?? undefined,
      postalCode: responsavelPayer.enderecoCep ?? undefined,
      addressNumber: responsavelPayer.enderecoNumero ?? undefined,
      complement: responsavelPayer.enderecoComplemento ?? undefined,
      province: responsavelPayer.enderecoBairro ?? undefined,
      asaasCustomerId: responsavelPayer.asaasCustomerId ?? undefined,
    };
  } else {
    payerForEnsure = {
      type: 'ALUNO' as const,
      id: aluno.id,
      name: normalizedData.nome,
      cpfCnpj: normalizedData.cpf ?? '',
      email: normalizedData.email ?? undefined,
      phone: normalizedData.telefone ?? undefined,
      mobilePhone: normalizedData.telefone ?? undefined,
      address: normalizedData.endereco?.logradouro ?? undefined,
      postalCode: normalizedData.endereco?.cep ?? undefined,
      addressNumber: normalizedData.endereco?.numero ?? undefined,
      complement: normalizedData.endereco?.complemento ?? undefined,
      province: normalizedData.endereco?.bairro ?? undefined,
    };
  }

  try {
    const ensureStartedAt = Date.now();
    const ensureResult = await ensureAsaasCustomerForPayer({
      contaId: normalizedData.contaId,
      payer: payerForEnsure,
      notificationSyncMode: 'deferred',
    });

    if (!ensureResult.ok) {
      throw new AsaasCustomerEnsureError(
        ensureResult.error,
        ensureResult.message,
        ensureResult.status,
      );
    }

    console.log('✅ Customer ensured', {
      customerId: ensureResult.customerId,
      reused: ensureResult.reused,
      durationMs: Date.now() - ensureStartedAt,
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      if (aluno?.id) {
        await tx.alunoResponsavel.deleteMany({ where: { alunoId: aluno.id } });
        await tx.aluno.delete({ where: { id: aluno.id } });
      }
      if (createdResponsavelId) {
        await tx.responsavel.delete({ where: { id: createdResponsavelId } });
      }
    });
    throw error;
  }

  const refreshedAluno = await prisma.aluno.findUnique({ where: { id: aluno.id } });
  return refreshedAluno ?? aluno;
}

/**
 * Sincroniza a inativação de um aluno com o Asaas (soft delete do customer).
 * Chamado quando o aluno é arquivado/inativado.
 * 
 * REGRA CRÍTICA: Só inativa o customer se ele NÃO for compartilhado
 * (ex.: responsável financeiro de múltiplos alunos ativos)
 */
async function syncAlunoInativacaoToAsaas(params: {
  alunoId: string;
  contaId: string;
}): Promise<{ success: boolean; action: 'INACTIVATED' | 'SKIPPED' | 'ERROR'; error?: string; reason?: string }> {
  const { alunoId, contaId } = params;

  try {
    // Buscar aluno com responsável
    const aluno = await prisma.aluno.findUnique({
      where: { id: alunoId },
      include: {
        responsaveis: {
          include: { responsavel: true },
          take: 1,
        },
      },
    });

    if (!aluno) {
      console.warn('⚠️ [Asaas Inativação] Aluno não encontrado:', alunoId);
      return { success: false, action: 'ERROR', error: 'ALUNO_NOT_FOUND' };
    }

    // Determinar quem é o pagador (menor = responsável, maior = aluno)
    const idade = calcIdade(aluno.dataNasc);
    const isMenor = idade < 18;
    const responsavel = aluno.responsaveis[0]?.responsavel ?? null;

    // Transição menor → maior: criar customer do aluno se ainda não existir
    if (!isMenor && !aluno.asaasCustomerId) {
      const payerForEnsure: EnsureAsaasCustomerPayer = {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf ?? '',
        email: aluno.email ?? undefined,
        phone: aluno.telefone ?? undefined,
        mobilePhone: aluno.telefone ?? undefined,
        address: aluno.enderecoLogradouro ?? undefined,
        postalCode: aluno.enderecoCep ?? undefined,
        addressNumber: aluno.enderecoNumero ?? undefined,
        complement: aluno.enderecoComplemento ?? undefined,
        province: aluno.enderecoBairro ?? undefined,
      };

      if (!payerForEnsure.cpfCnpj) {
        console.warn('⚠️ [Asaas Sync] Aluno maior sem CPF/CNPJ, impossível criar customer próprio.');
        return { success: true, action: 'SKIPPED', reason: 'MISSING_CPF_CNPJ' };
      }

      const ensureResult = await ensureAsaasCustomerForPayer({
        contaId,
        payer: payerForEnsure,
      });

      if (!ensureResult.ok) {
        console.warn('⚠️ [Asaas Sync] Falha ao criar customer do aluno (transição maioridade):', ensureResult.message);
        return { success: false, action: 'ERROR', error: 'ENSURE_CUSTOMER_FAILED' };
      }

      console.log('✅ [Asaas Sync] Customer do aluno criado (transição maioridade):', ensureResult.customerId);
      return { success: true, action: 'SKIPPED', reason: 'ADULT_CUSTOMER_CREATED' };
    }

    const customerId = isMenor ? responsavel?.asaasCustomerId : aluno.asaasCustomerId;

    if (!customerId) {
      console.debug('🔕 [Asaas Inativação] Sem customer ID para inativar:', { alunoId, isMenor });
      return { success: true, action: 'SKIPPED', reason: 'NO_CUSTOMER_ID' };
    }

    // Verificar se customer é compartilhado antes de inativar
    const canInactivateResult = await canInactivateAsaasCustomer({
      asaasCustomerId: customerId,
      contaId,
      excludeAlunoId: alunoId,
    });

    if (!canInactivateResult.canInactivate) {
      console.info('🔕 [Asaas Inativação] Customer compartilhado, não inativando:', {
        customerId,
        alunoId,
        reason: canInactivateResult.reason,
        sharedWith: canInactivateResult.sharedWith,
      });
      return {
        success: true,
        action: 'SKIPPED',
        reason: canInactivateResult.reason,
      };
    }

    // Carregar API key da subconta
    const keyResult = await loadAndValidateSubaccountKey(contaId);
    if (!keyResult.ok) {
      console.warn('⚠️ [Asaas Inativação] API key inválida ou não configurada:', keyResult.message);
      return { success: false, action: 'ERROR', error: 'INVALID_API_KEY' };
    }

    // Soft delete do customer no Asaas
    await deleteAsaasCustomer({
      apiKey: keyResult.apiKey,
      customerId,
    });

    console.log('✅ [Asaas Inativação] Customer inativado:', customerId);
    return { success: true, action: 'INACTIVATED' };
  } catch (error) {
    // Fail-safe: não quebrar o fluxo principal
    console.error('⚠️ [Asaas Inativação] Falha ao inativar (não-bloqueante):', error);
    return { success: false, action: 'ERROR', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' };
  }
}

/**
 * Sincroniza os dados de um aluno/responsável com o Asaas de forma assíncrona (fire-and-forget).
 * Chamado após update local para manter consistência.
 */
async function syncAlunoToAsaas(params: {
  alunoId: string;
  contaId: string;
}): Promise<void> {
  const { alunoId, contaId } = params;

  try {
    // Buscar aluno com responsável
    const aluno = await prisma.aluno.findUnique({
      where: { id: alunoId },
      include: {
        responsaveis: {
          include: { responsavel: true },
          take: 1,
        },
      },
    });

    if (!aluno) {
      console.warn('⚠️ [Asaas Sync] Aluno não encontrado:', alunoId);
      return;
    }

    // Determinar quem é o pagador (menor = responsável, maior = aluno)
    const idade = calcIdade(aluno.dataNasc);
    const isMenor = idade < 18;
    const responsavel = aluno.responsaveis[0]?.responsavel ?? null;
    const payerForEnsure: EnsureAsaasCustomerPayer | null = isMenor
      ? (responsavel
          ? {
              type: 'RESPONSAVEL',
              id: responsavel.id,
              name: responsavel.nome,
              cpfCnpj: responsavel.cpf,
              email: responsavel.email,
              phone: responsavel.telefone,
              mobilePhone: responsavel.telefone,
              address: responsavel.enderecoLogradouro ?? undefined,
              postalCode: responsavel.enderecoCep ?? undefined,
              addressNumber: responsavel.enderecoNumero ?? undefined,
              complement: responsavel.enderecoComplemento ?? undefined,
              province: responsavel.enderecoBairro ?? undefined,
            }
          : null)
      : {
          type: 'ALUNO',
          id: aluno.id,
          name: aluno.nome,
          cpfCnpj: aluno.cpf ?? '',
          email: aluno.email ?? undefined,
          phone: aluno.telefone ?? undefined,
          mobilePhone: aluno.telefone ?? undefined,
          address: aluno.enderecoLogradouro ?? undefined,
          postalCode: aluno.enderecoCep ?? undefined,
          addressNumber: aluno.enderecoNumero ?? undefined,
          complement: aluno.enderecoComplemento ?? undefined,
          province: aluno.enderecoBairro ?? undefined,
        };

    if (!payerForEnsure) {
      console.warn('⚠️ [Asaas Sync] Aluno menor sem responsável; não é possível sincronizar customer.');
      return;
    }

    if (!payerForEnsure.cpfCnpj) {
      console.warn('⚠️ [Asaas Sync] Pagador sem CPF/CNPJ, impossível sincronizar customer.');
      return;
    }

    // Importante: usa o ensure mesmo quando já existe customerId.
    // Isso garante idempotência e corrige o caso de customer soft-deletado no Asaas
    // (restaura antes de atualizar).
    const ensureResult = await ensureAsaasCustomerForPayer({
      contaId,
      payer: payerForEnsure,
    });

    if (!ensureResult.ok) {
      console.warn('⚠️ [Asaas Sync] Falha ao sincronizar customer:', ensureResult.message);
      return;
    }

    console.log('✅ [Asaas Sync] Customer sincronizado (ensure):', ensureResult.customerId);
  } catch (error) {
    // Fail-safe: não quebrar o fluxo principal
    console.error('⚠️ [Asaas Sync] Falha ao sincronizar (não-bloqueante):', error);
  }
}

type MaybeEndereco = { endereco?: Partial<AlunoCreateInput['endereco']> };
type UpdateAlunoWithResponsavel = AlunoUpdateInput &
  MaybeEndereco & {
    contaId: string;
    responsavel?: Partial<{
      nome: string;
      cpf: string;
      email: string;
      telefone: string;
      endereco?: Partial<{
        cep: string;
        logradouro: string;
        numero: string;
        complemento?: string;
        bairro: string;
        cidade: string;
        uf: string;
      }>;
    }>;
  };
export async function updateAluno(data: UpdateAlunoWithResponsavel) {
  const { id, contaId, endereco, responsavel, ...rest } = data;

  // Normalizações leves
  const normEmail = (v?: string | null) =>
    typeof v === 'string' ? v.trim().toLowerCase() : (v ?? undefined);
  const digits = (v?: string | null) =>
    typeof v === 'string' ? v.replace(/\D/g, '') : (v ?? undefined);

  // Preparar campos de endereço do aluno se fornecidos (flatten)
  const enderecoFields = endereco ? flattenAlunoEndereco({ endereco }) : {};

  return prisma.$transaction(async (tx) => {
    // MULTI-TENANT: verificar se aluno pertence à conta antes de atualizar
    const existing = await tx.aluno.findFirst({
      where: { id, contaId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error('Aluno não encontrado');
    }

    // Atualiza aluno em si
    const aluno = await tx.aluno.update({
      where: { id },
      data: {
        ...rest,
        email: normEmail(rest.email),
        telefone: digits(rest.telefone),
        cpf: digits(rest.cpf),
        contatoEmergenciaTelefone: digits(rest.contatoEmergenciaTelefone),
        ...enderecoFields,
      },
    });

    // Atualiza/cria responsável se enviado
    if (responsavel && Object.keys(responsavel).length > 0) {
      // Existe vínculo atual?
      const vinc = await tx.alunoResponsavel.findFirst({ where: { alunoId: id } });
      if (vinc) {
        const respUpdateData: Record<string, unknown> = {};
        if (typeof responsavel.nome === 'string') respUpdateData.nome = responsavel.nome;
        {
          const v = digits(responsavel.cpf);
          if (v) respUpdateData.cpf = v;
        }
        {
          const v = normEmail(responsavel.email);
          if (v) respUpdateData.email = v;
        }
        {
          const v = digits(responsavel.telefone);
          if (v) respUpdateData.telefone = v;
        }
        if (responsavel.endereco)
          Object.assign(
            respUpdateData,
            flattenResponsavelEndereco({ endereco: responsavel.endereco }),
          );
        if (Object.keys(respUpdateData).length > 0) {
          // MULTI-TENANT: garantir que responsável é da mesma conta
          await tx.responsavel.updateMany({
            where: { id: vinc.responsavelId, contaId },
            data: respUpdateData,
          });
        }
      } else {
        // cria novo responsável e vincula
        const nome = responsavel.nome?.trim();
        const cpf = digits(responsavel.cpf);
        const email = normEmail(responsavel.email);
        const telefone = digits(responsavel.telefone);
        if (nome && cpf && email && telefone) {
          const resp = await tx.responsavel.create({
            data: {
              contaId,
              nome,
              cpf,
              email,
              telefone,
              ...flattenResponsavelEndereco({ endereco: responsavel.endereco ?? null }),
              financeiro: true,
            },
          });
          await tx.alunoResponsavel.create({
            data: { alunoId: id, responsavelId: resp.id, tipoVinculo: 'PRINCIPAL' },
          });
        }
      }
    }

    // Sincronizar atualização com Asaas (fire-and-forget, não bloqueia)
    syncAlunoToAsaas({ alunoId: id, contaId }).catch((err) => {
      console.error('⚠️ [Asaas Sync] Erro não capturado:', err);
    });

    return aluno;
  });
}

export async function getAluno(id: string, contaId?: string) {
  return prisma.aluno.findFirst({
    where: { id, ...(contaId ? { contaId } : {}) },
    include: {
      responsaveis: { include: { responsavel: true } },
    },
  });
}

export async function deleteAluno(
  id: string,
  contaId: string,
  motivo?: string,
  forceDelete = false,
  actorId?: string,
) {
  console.log('🗑️ Solicitacao de exclusao de aluno', { id, motivo: motivo?.slice(0, 120), forceDelete });

  const aluno = await prisma.aluno.findFirst({
    where: { id, contaId },
    include: {
      responsaveis: {
        include: { responsavel: true },
      },
    },
  });

  if (!aluno) {
    const error = new Error('Aluno não encontrado.') as Error & { code?: string };
    error.code = 'ALUNO_NOT_FOUND';
    throw error;
  }

  const dependencies = await getAlunoDeletionDependencies(aluno);
  const canHardDelete = dependencies.canHardDelete;
  const actorType = actorId ? 'USER' : 'SYSTEM';

  // Se não há histórico financeiro, o hard delete local é seguro.
  // Ainda assim, mantemos a inativação do customer no Asaas como best-effort
  // (soft delete) antes de remover o registro local.
  if (canHardDelete) {
    const inativacaoResult = await syncAlunoInativacaoToAsaas({ alunoId: id, contaId }).catch((err) => {
      console.error('⚠️ [Asaas Inativação] Erro não capturado:', err);
      return { success: false, action: 'ERROR' as const, error: err instanceof Error ? err.message : 'UNKNOWN' };
    });

    return prisma.$transaction(async (tx) => {
      // Remove vínculos antes do delete do aluno (FK safety)
      await tx.alunoResponsavel.deleteMany({ where: { alunoId: id } });

      // Remove customer local do pagador ALUNO (não remove responsável, pois pode ser compartilhado)
      await tx.customer.deleteMany({
        where: {
          contaId,
          payerType: 'ALUNO',
          payerId: id,
        },
      });

      // MULTI-TENANT: atomicidade no delete
      const deletedInfo = await tx.aluno.deleteMany({ where: { id, contaId } });
      if (deletedInfo.count === 0) {
        throw new Error('Aluno não encontrado para exclusão');
      }

      await tx.auditLog.create({
        data: {
          contaId,
          actorType,
          actorId: actorId ?? undefined,
          action: 'ALUNO_HARD_DELETED',
          entityType: 'ALUNO',
          entityId: id,
          metadata: {
            motivo: motivo || null,
            forceDeleteRequested: forceDelete,
            hardDeleteAllowed: canHardDelete,
            dependencies: dependencies.summary,
            customerInactivation: inativacaoResult,
          },
        },
      });

      if (inativacaoResult.action !== 'ERROR') {
        await tx.auditLog.create({
          data: {
            contaId,
            actorType: 'SYSTEM',
            action: 'ASAAS_CUSTOMER_INACTIVATION_RESULT',
            entityType: 'ALUNO',
            entityId: id,
            metadata: { ...inativacaoResult },
          },
        });
      }

      // Retornar objeto simulado pois deleteMany retorna BatchPayload
      return { id, contaId };
    });
  }

  // === PASSO 1: Cancelar matrículas ativas antes de arquivar ===
  // Isso garante que não existam matrículas "órfãs" com status ativo
  // quando o aluno é arquivado.
  let archiveResult: AlunoArchiveResult | null = null;
  try {
    archiveResult = await executeAlunoArchivePolicy(id, contaId, {
      prisma,
      actorId: actorId ?? 'system',
      motivo: motivo ?? 'Matrícula cancelada: aluno arquivado',
      // syncMatriculaStatus não é injetado aqui pois a policy está no @alusa/lib
      // que não tem dependência de @alusa/finance. O cancelamento será local.
      // Para cancelamento com sync Asaas, usar a rota DELETE /api/alunos/:id
    });

    if (archiveResult.totalMatriculasCancelled > 0) {
      console.log(
        `📋 [Aluno Archive] ${archiveResult.totalMatriculasCancelled} matrícula(s) cancelada(s)`,
        archiveResult.matriculasCancelled.map((m) => ({
          id: m.matriculaId,
          from: m.previousStatus,
          action: m.asaasAction,
        })),
      );
    }
  } catch (err) {
    console.error('⚠️ [Aluno Archive] Erro ao cancelar matrículas:', err);
    // Continua com o arquivamento mesmo se falhar o cancelamento
  }

  // === PASSO 2: Arquivar o aluno ===
  const alunoAtualizado = await prisma.$transaction(async (tx) => {
    // Normalizar motivo se não informado
    const motivoFinal = motivo?.trim() || 'Arquivado automaticamente: possui vínculos ativos.';

    // MULTI-TENANT: atomicidade no update
    const updatedInfo = await tx.aluno.updateMany({
      where: { id, contaId },
      data: {
        status: 'INATIVO',
        motivoInativacao: motivoFinal,
        dataInativacao: new Date(),
      },
    });
    if (updatedInfo.count === 0) {
      throw new Error('Aluno não encontrado para arquivamento');
    }
    const updated = await tx.aluno.findFirst({ where: { id, contaId } });
    if (!updated) throw new Error('Erro ao recuperar aluno arquivado');

    await tx.auditLog.create({
      data: {
        contaId,
        actorType,
        actorId: actorId ?? undefined,
        action: 'ALUNO_ARQUIVADO',
        entityType: 'ALUNO',
        entityId: id,
        metadata: {
          motivo: motivoFinal,
          forceDeleteRequested: forceDelete,
          hardDeleteAllowed: canHardDelete,
          dependencies: dependencies.summary,
          matriculasCanceladas: archiveResult
            ? {
              total: archiveResult.totalMatriculasCancelled,
              erros: archiveResult.totalErrors,
              detalhes: archiveResult.matriculasCancelled.map((m) => ({
                id: m.matriculaId,
                statusAnterior: m.previousStatus,
                cancelada: m.cancelled,
                asaasAction: m.asaasAction,
                erro: m.error,
              })),
            }
            : null,
        },
      },
    });

    return updated;
  });

  // Inativação do customer (soft delete no Asaas) só é segura quando não há histórico/vínculos.
  // Para alunos arquivados com matrículas/assinaturas/cobranças, manter o customer evita efeitos colaterais.
  const shouldInactivateCustomer =
    dependencies.summary.matriculas === 0 &&
    dependencies.summary.cobrancas === 0 &&
    dependencies.summary.pagamentos === 0 &&
    dependencies.summary.subscriptions === 0 &&
    dependencies.summary.installmentPlans === 0 &&
    dependencies.summary.contratos === 0 &&
    dependencies.summary.webhooks === 0;

  const inativacaoResult = shouldInactivateCustomer
    ? await syncAlunoInativacaoToAsaas({ alunoId: id, contaId }).catch((err) => {
        console.error('⚠️ [Asaas Inativação] Erro não capturado:', err);
        return { success: false, action: 'ERROR' as const, error: err instanceof Error ? err.message : 'UNKNOWN' };
      })
    : { success: true, action: 'SKIPPED' as const, reason: 'HAS_DEPENDENCIES' };

  // Registrar resultado da inativação do customer
  if (inativacaoResult.action !== 'ERROR') {
    await prisma.auditLog.create({
      data: {
        contaId,
        actorType: 'SYSTEM',
        action: 'ASAAS_CUSTOMER_INACTIVATION_RESULT',
        entityType: 'ALUNO',
        entityId: id,
        metadata: {
          ...inativacaoResult,
        },
      },
    });
  }

  // Retornar aluno com informação adicional sobre arquivamento
  return Object.assign(alunoAtualizado, {
    _customerInactivation: inativacaoResult,
    _matriculasCanceladas: archiveResult
      ? {
        total: archiveResult.totalMatriculasCancelled,
        erros: archiveResult.totalErrors,
      }
      : null,
  });
}

export async function reactivateAluno(id: string) {
  return prisma.aluno.update({
    where: { id },
    data: {
      status: 'ATIVO',
      motivoInativacao: null,
      dataInativacao: null,
    },
  });
}

function hashToDigits(value: string, length: number): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  const base = String(hash).padStart(10, '0');
  let out = base;
  while (out.length < length) out += base;
  return out.slice(0, length);
}

export interface AnonimizarAlunoInput {
  id: string;
  contaId: string;
  motivo?: string;
  actorId?: string;
}

export async function anonimizarAluno(input: AnonimizarAlunoInput) {
  const { id, contaId, motivo, actorId } = input;
  const anonDate = new Date('1900-01-01T00:00:00.000Z');

  return prisma.$transaction(async (tx) => {
    const aluno = await tx.aluno.findFirst({
      where: { id, contaId },
      select: { id: true },
    });
    if (!aluno) {
      throw new Error('Aluno não encontrado ou não pertence a esta conta');
    }

    const updated = await tx.aluno.update({
      where: { id },
      data: {
        nome: 'ALUNO ANONIMIZADO',
        nomeSocial: null,
        dataNasc: anonDate,
        cpf: null,
        email: null,
        telefone: null,
        foto: null,
        enderecoCep: null,
        enderecoLogradouro: null,
        enderecoNumero: null,
        enderecoComplemento: null,
        enderecoBairro: null,
        enderecoCidade: null,
        enderecoUf: null,
        observacao: null,
        genero: null,
        alergias: null,
        restricoesMedicas: null,
        contatoEmergenciaNome: null,
        contatoEmergenciaTelefone: null,
        origemCadastro: null,
        tamanhoCamiseta: null,
        tamanhoCalcado: null,
        tags: [],
        consentimentoImagem: false,
        dataConsentimentoImagem: null,
        consentimentoComunicacoes: false,
      },
    });

    await tx.contrato.updateMany({
      where: { matricula: { alunoId: id } },
      data: {
        assinadoPor: null,
        assinadoEmail: null,
        assinadoCpf: null,
      },
    });

    await tx.auditLog.create({
      data: {
        contaId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        action: 'ALUNO_ANONIMIZADO',
        entityType: 'ALUNO',
        entityId: id,
        metadata: {
          motivo: motivo || null,
        },
      },
    });

    return updated;
  });
}

export interface AnonimizarResponsavelInput {
  id: string;
  contaId: string;
  motivo?: string;
  actorId?: string;
}

export async function anonimizarResponsavel(input: AnonimizarResponsavelInput) {
  const { id, contaId, motivo, actorId } = input;

  return prisma.$transaction(async (tx) => {
    const responsavel = await tx.responsavel.findFirst({
      where: { id, contaId },
      select: { id: true },
    });
    if (!responsavel) {
      throw new Error('Responsável não encontrado ou não pertence a esta conta');
    }

    const anonDigits = hashToDigits(id, 11);
    const anonEmail = `anon+responsavel-${id}@anon.local`;

    const updated = await tx.responsavel.update({
      where: { id },
      data: {
        nome: 'RESPONSAVEL ANONIMIZADO',
        cpf: anonDigits,
        email: anonEmail,
        telefone: anonDigits,
        enderecoCep: null,
        enderecoLogradouro: null,
        enderecoNumero: null,
        enderecoComplemento: null,
        enderecoBairro: null,
        enderecoCidade: null,
        enderecoUf: null,
        asaasCreditCardToken: null,
        creditCardBrand: null,
        creditCardLast4: null,
        creditCardExpiryMonth: null,
        creditCardExpiryYear: null,
        creditCardUpdatedAt: null,
        preferredBillingType: null,
      },
    });

    await tx.auditLog.create({
      data: {
        contaId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        action: 'RESPONSAVEL_ANONIMIZADO',
        entityType: 'RESPONSAVEL',
        entityId: id,
        metadata: {
          motivo: motivo || null,
        },
      },
    });

    return updated;
  });
}

// Tipos para inativação e reativação completa
export interface InativarAlunoInput {
  id: string;
  contaId: string;
  motivo: string;
  acao: 'PAUSAR' | 'CANCELAR';
  actorId: string;
}

export interface ReativarAlunoCompletoInput {
  id: string;
  contaId: string;
  reativarMatriculas?: boolean;
  matriculasIds?: string[];
  actorId: string;
}

export async function inativarAluno({
  id,
  contaId,
  motivo,
  acao,
  actorId,
}: InativarAlunoInput) {
  return prisma.$transaction(async (tx) => {
    // 1. Verificar se aluno pertence à conta
    const aluno = await tx.aluno.findFirst({
      where: { id, contaId },
    });

    if (!aluno) {
      throw new Error('Aluno não encontrado ou não pertence a esta conta');
    }

    if (aluno.status === 'INATIVO') {
      throw new Error('Aluno já está inativo');
    }

    // 2. Atualizar status do aluno
    const alunoAtualizado = await tx.aluno.update({
      where: { id },
      data: {
        status: 'INATIVO',
        motivoInativacao: motivo,
        dataInativacao: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        contaId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        action: 'ALUNO_ARQUIVADO',
        entityType: 'ALUNO',
        entityId: id,
        metadata: {
          motivo,
          acao,
        },
      },
    });

    // 3. Se ação for CANCELAR, encerrar matrículas ativas
    if (acao === 'CANCELAR') {
      await tx.matricula.updateMany({
        where: {
          alunoId: id,
          statusContrato: 'ATIVO',
        },
        data: {
          statusContrato: 'CANCELADO',
        },
      });
    }

    return {
      aluno: alunoAtualizado,
      acao,
      message: acao === 'PAUSAR' ? 'Aluno pausado com sucesso' : 'Aluno cancelado com sucesso',
    };
  });
}

export async function reativarAlunoCompleto({
  id,
  contaId,
  reativarMatriculas = false,
  matriculasIds,
}: ReativarAlunoCompletoInput) {
  return prisma.$transaction(async (tx) => {
    // 1. Verificar se aluno pertence à conta
    const aluno = await tx.aluno.findFirst({
      where: { id, contaId },
    });

    if (!aluno) {
      throw new Error('Aluno não encontrado ou não pertence a esta conta');
    }

    if (aluno.status === 'ATIVO') {
      throw new Error('Aluno já está ativo');
    }

    // 2. Reativar aluno
    const alunoAtualizado = await tx.aluno.update({
      where: { id },
      data: {
        status: 'ATIVO',
        motivoInativacao: null,
        dataInativacao: null,
      },
    });

    // 3. Reativar matrículas se solicitado
    if (reativarMatriculas) {
      if (matriculasIds && matriculasIds.length > 0) {
        // Reativar apenas matrículas específicas
        await tx.matricula.updateMany({
          where: {
            id: { in: matriculasIds },
            alunoId: id,
          },
          data: {
            statusContrato: 'ATIVO',
          },
        });
      } else {
        // Reativar todas as matrículas canceladas
        await tx.matricula.updateMany({
          where: {
            alunoId: id,
            statusContrato: 'CANCELADO',
          },
          data: {
            statusContrato: 'ATIVO',
          },
        });
      }
    }

    return {
      aluno: alunoAtualizado,
      message: 'Aluno reativado com sucesso',
    };
  });
}

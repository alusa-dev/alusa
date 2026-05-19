import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import type { Status } from '@prisma/client';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { createAluno, updateAluno, formatZodErrors, type AlunoCreateInput, AsaasCustomerEnsureError } from '@alusa/lib';
import {
  createAlunoInputDTOSchema,
  alunoDetailDTOSchema,
  listAlunosResultDTOSchema,
} from '@/features/cadastro/alunos/dtos';
import { mapAlunoDetailToDTO, mapAlunoListItemToDTO } from '@/features/cadastro/alunos/mappers';
import { normalizeAvatarUpload } from '@/src/server/media/avatar-storage.service';

// Util simples para limpar dígitos
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : v);

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const status = (searchParams.get('status') || '').trim().toUpperCase();
    const pageParam = searchParams.get('page');
    const page = pageParam ? Math.max(1, Number(pageParam) || 1) : 1;
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get('pageSize') || (pageParam ? '6' : '100')) || 6),
    );
    const sortOrder = searchParams.get('sortOrder') === 'DESC' ? 'desc' : 'asc';

    const result = await withTenantSession(async ({ contaId, tx }) => {
      const where = {
        contaId,
        ...(status && status !== 'TODOS' ? { status: status as Status } : {}),
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' as const } },
                ...(q.replace(/\D/g, '')
                  ? [{ cpf: { contains: q.replace(/\D/g, '') } }]
                  : []),
              ],
            }
          : {}),
      };

      const [total, alunos] = await Promise.all([
        tx.aluno.count({ where }),
        tx.aluno.findMany({
        where,
        orderBy: { nome: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          nome: true,
          email: true,
          telefone: true,
          status: true,
          foto: true,
          updatedAt: true,
          cpf: true,
          consentimentoImagem: true,
          dataConsentimentoImagem: true,
          isentoTaxaMatricula: true,
          bolsaDescontoPercent: true,
          tags: true,
          dataInativacao: true,
          motivoInativacao: true,
        },
      }),
      ]);

      return {
        total,
        page,
        pageSize,
        items: alunos.map((aluno) => {
        const bolsaRaw = aluno.bolsaDescontoPercent;
        const bolsaDescontoPercent =
          bolsaRaw === null || bolsaRaw === undefined ? null : Number(bolsaRaw);

        return {
          id: aluno.id,
          nome: aluno.nome ?? '',
          email: aluno.email ?? null,
          telefone: aluno.telefone ?? null,
          status: aluno.status ?? 'ATIVO',
          foto: aluno.foto ?? null,
          updatedAt: aluno.updatedAt,
          cpf: aluno.cpf ?? null,
          consentimentoImagem: aluno.consentimentoImagem ?? null,
          dataConsentimentoImagem: aluno.dataConsentimentoImagem
            ? aluno.dataConsentimentoImagem.toISOString()
            : null,
          isentoTaxaMatricula: aluno.isentoTaxaMatricula ?? null,
          bolsaDescontoPercent,
          tags: Array.isArray(aluno.tags) ? aluno.tags : null,
        };
      }),
      };
    });

    if (result instanceof NextResponse) {
      return result;
    }

    return NextResponse.json(
      listAlunosResultDTOSchema.parse({
        items: result.items.map((item) => mapAlunoListItemToDTO(item)),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      }),
      {
        headers: {
          'cache-control': 'private, max-age=20, stale-while-revalidate=60',
        },
      },
    );
  } catch (error) {
    console.error('Erro ao listar alunos:', error);
    return NextResponse.json({ error: 'Erro ao carregar alunos' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // MULTI-TENANT: validar sessão e usar contaId da sessão
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } })?.user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const raw = await request.json();

    // Só monta endereço se o usuário realmente informou dados mínimos (CEP + número)
    const hasCep = Boolean(digits(raw.enderecoCep));
    const hasNumero = Boolean(String(raw.enderecoNumero || '').trim());

    const endereco = (hasCep && hasNumero)
      ? {
          cep: String(digits(raw.enderecoCep)),
          logradouro: raw.enderecoLogradouro?.trim() || undefined,
          numero: String(raw.enderecoNumero).trim(),
          complemento: raw.enderecoComplemento?.trim() || undefined,
          bairro: raw.enderecoBairro?.trim() || undefined,
          cidade: raw.enderecoCidade?.trim() || undefined,
          uf: raw.enderecoUf ? String(raw.enderecoUf).slice(0, 2).toUpperCase() : undefined,
        }
      : undefined;

    // Normalizar responsavel (sem placeholders)
    let responsavel = raw.responsavel;
    if (responsavel) {
      const respHasCep = Boolean(digits(responsavel.enderecoCep));
      const respHasNumero = Boolean(String(responsavel.enderecoNumero || '').trim());

      responsavel = {
        ...responsavel,
        cpf: digits(responsavel.cpf),
        telefone: digits(responsavel.telefone),
        endereco: (respHasCep && respHasNumero)
          ? {
              cep: String(digits(responsavel.enderecoCep)),
              logradouro: responsavel.enderecoLogradouro?.trim() || undefined,
              numero: String(responsavel.enderecoNumero).trim(),
              complemento: responsavel.enderecoComplemento?.trim() || undefined,
              bairro: responsavel.enderecoBairro?.trim() || undefined,
              cidade: responsavel.enderecoCidade?.trim() || undefined,
              uf: responsavel.enderecoUf ? String(responsavel.enderecoUf).slice(0, 2).toUpperCase() : undefined,
            }
          : undefined,
      };
    }

    const transformed = {
      contaId,
      nome: raw.nome,
      nomeSocial: raw.nomeSocial || undefined,
      dataNasc: raw.dataNasc
        ? typeof raw.dataNasc === 'string'
          ? new Date(raw.dataNasc)
          : raw.dataNasc
        : undefined,
      cpf: digits(raw.cpf),
      email: raw.email,
      telefone: digits(raw.telefone),
      endereco,
      observacao: raw.observacao || undefined,
      genero: raw.genero || undefined,
      modalidadePrincipal: raw.modalidadePrincipal || undefined,
      nivel: raw.nivel || undefined,
      alergias: raw.alergias || undefined,
      restricoesMedicas: raw.restricoesMedicas || undefined,
      contatoEmergenciaNome: raw.contatoEmergenciaNome || undefined,
      contatoEmergenciaTelefone: raw.contatoEmergenciaTelefone
        ? digits(raw.contatoEmergenciaTelefone)
        : undefined,
      origemCadastro: raw.origemCadastro || undefined,
      bolsaDescontoPercent: raw.bolsaDescontoPercent ?? undefined,
      isentoTaxaMatricula: raw.isentoTaxaMatricula ?? undefined,
      consentimentoImagem: raw.consentimentoImagem ?? undefined,
      dataConsentimentoImagem: raw.dataConsentimentoImagem
        ? new Date(raw.dataConsentimentoImagem)
        : undefined,
      consentimentoComunicacoes: raw.consentimentoComunicacoes ?? undefined,
      tamanhoCamiseta: raw.tamanhoCamiseta || undefined,
      tamanhoCalcado: raw.tamanhoCalcado || undefined,
      tags: raw.tags || undefined,
      status: raw.status || 'ATIVO',
      responsavelExistenteId:
        typeof raw.responsavelExistenteId === 'string' && raw.responsavelExistenteId.trim()
          ? raw.responsavelExistenteId.trim()
          : undefined,
      responsavel: responsavel || undefined,
      foto: raw.foto || undefined,
    };

    let parsed: AlunoCreateInput;
    try {
      parsed = createAlunoInputDTOSchema.parse(transformed);
    } catch (e) {
      const issues = (e as { issues?: Array<{ path: (string | number)[]; message: string }> })
        .issues;
      if (issues?.length) {
        // Retorna todos os erros formatados (field + message)
        const errors = formatZodErrors(issues);
        return NextResponse.json(
          {
            error: errors[0].message,
            field: errors[0].field,
            errors, // Array completo para o frontend
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
    }

    let aluno = await createAluno(parsed);

    if (parsed.foto?.startsWith('data:image/')) {
      const normalizedFoto = await normalizeAvatarUpload({
        entity: 'aluno',
        entityId: aluno.id,
        contaId,
        foto: parsed.foto,
        previousFoto: null,
      });

      if (normalizedFoto && normalizedFoto !== parsed.foto) {
        aluno = await updateAluno({ id: aluno.id, contaId, foto: normalizedFoto });
      }
    }

    // NOTA: syncAlunoWithAsaas já é chamado dentro de createAluno()
    // Não é necessário chamar createAsaasCustomerForAluno aqui para evitar duplicação

    return NextResponse.json(alunoDetailDTOSchema.parse(mapAlunoDetailToDTO(aluno)), { status: 201 });
  } catch (error) {
    console.error('Erro ao criar aluno:', error);
    if (error instanceof AsaasCustomerEnsureError) {
      const isConfigError = ['MISSING_KEY', 'DECRYPT_FAILED', 'INVALID_KEY'].includes(error.code);
      const providerStatus = error.providerStatus;
      const status =
        error.code === 'PAYER_INVALID'
          ? 400
          : error.code === 'ASAAS_ERROR' && providerStatus
            ? providerStatus
            : isConfigError
              ? 412
              : 503;
      const message =
        error.code === 'PAYER_INVALID'
          ? error.message
          : error.code === 'ASAAS_ERROR' && providerStatus && [400, 422].includes(providerStatus)
            ? error.message
            : isConfigError
              ? 'Conta de pagamentos não configurada.'
              : 'Serviço de pagamentos indisponível. Tente novamente.';
      return NextResponse.json({ error: message }, { status });
    }
    const msg: string = (error as Error).message || '';
    if (msg.includes('já existe') || msg.includes('já está em uso')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

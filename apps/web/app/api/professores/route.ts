import { NextResponse } from 'next/server';
import {
  createProfessorInputDTOSchema,
  listProfessoresResultDTOSchema,
  professorMutationResultDTOSchema,
} from '@/features/cadastro/professores/dtos';
import { mapProfessorRecordToDTO } from '@/features/cadastro/professores/mappers';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  createProfessor,
  listProfessores,
  syncProfessoresFromColaboradores,
} from '@/src/server/professores/professor.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type CreateBody = {
  contaId: string;
  nome: string;
  cpf: string;
  rg?: string | null;
  dataNasc: Date;
  sexo?: string | null;
  estadoCivil?: string | null;
  nacionalidade?: string | null;
  email: string;
  telefoneCel: string;
  telefoneFixo?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  formacao?: string | null;
  especialidades?: string[];
  dataAdmissao?: Date | null;
  statusContratual?: 'EFETIVO' | 'TEMPORARIO' | 'PRESTADOR' | 'VOLUNTARIO' | null;
  cargaHoraria?: number | null;
  miniBio?: string | null;
  foto?: string | null;
  status: 'ATIVO' | 'INATIVO';
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim();
    const contaIdParam = url.searchParams.get('contaId')?.trim() || null;
    const tenant = await resolveTenantSession(contaIdParam);
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'CONTA_MISMATCH' ? 403 : 401,
        tenant.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        tenant.reason === 'CONTA_MISMATCH'
          ? 'A conta informada não pertence ao usuário autenticado.'
          : 'É necessário estar autenticado.',
      );
    }
    const contaId = tenant.contaId;
    const status = url.searchParams.get('status') || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    await syncProfessoresFromColaboradores(contaId);
    const { data, total } = await listProfessores({
      contaId,
      search: q || undefined,
      status: status || undefined,
      page,
      pageSize,
    });
    return NextResponse.json(
      listProfessoresResultDTOSchema.parse({
        data: data.map((item) => mapProfessorRecordToDTO(item as Record<string, unknown>)),
        page,
        pageSize,
        total,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e: unknown) {
    return jsonError(
      500,
      'ERRO_DESCONHECIDO',
      (e as Error)?.message || 'Erro ao listar professores',
    );
  }
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = createProfessorInputDTOSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    const data = parsed.data as CreateBody;
    const requestedContaId = data.contaId?.trim();
    const tenant = await resolveTenantSession(requestedContaId);
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'CONTA_MISMATCH' ? 403 : 401,
        tenant.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        tenant.reason === 'CONTA_MISMATCH'
          ? 'A conta informada não pertence ao usuário autenticado.'
          : 'É necessário estar autenticado.',
      );
    }
    const contaId = tenant.contaId;
    // Sanitização mínima
    const toCreate = {
      nome: data.nome.trim(),
      cpf: data.cpf,
      rg: data.rg || null,
      dataNasc: data.dataNasc,
      sexo: data.sexo || null,
      estadoCivil: data.estadoCivil || null,
      nacionalidade: data.nacionalidade || null,
      email: data.email.trim(),
      telefoneCel: data.telefoneCel,
      telefoneFixo: data.telefoneFixo || null,
      cep: data.cep || null,
      logradouro: data.logradouro || null,
      numero: data.numero || null,
      complemento: data.complemento || null,
      bairro: data.bairro || null,
      cidade: data.cidade || null,
      uf: data.uf || null,
      formacao: data.formacao || null,
      especialidades: data.especialidades ?? [],
      dataAdmissao: data.dataAdmissao || null,
      statusContratual: data.statusContratual || null,
      cargaHoraria: data.cargaHoraria || null,
      miniBio: data.miniBio || null,
      foto: data.foto || null,
      status: data.status,
      conta: { connect: { id: contaId } },
    } as const;

    try {
      const created = await createProfessor({ contaId, data: toCreate });
      return NextResponse.json(
        professorMutationResultDTOSchema.parse({
          data: mapProfessorRecordToDTO(created as Record<string, unknown>),
        }),
        { status: 201, headers: { 'cache-control': 'no-store' } },
      );
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') {
        return jsonError(409, 'CONFLITO_UNICO', 'CPF ou e-mail já cadastrados');
      }
      throw e;
    }
  } catch (e: unknown) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error)?.message || 'Dados inválidos');
  }
}

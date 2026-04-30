import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  createProfessorInputDTOSchema,
  listProfessoresResultDTOSchema,
  professorMutationResultDTOSchema,
} from '@/features/cadastro/professores/dtos';
import { mapProfessorRecordToDTO } from '@/features/cadastro/professores/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

const prisma = new PrismaClient();

async function ensureProfessoresFromColaboradores(contaId: string) {
  try {
    const [colaboradores, professoresExistentes] = await Promise.all([
      prisma.colaborador.findMany({
        where: { contaId, cargo: 'PROFESSOR' },
        select: {
          id: true,
          nome: true,
          cpf: true,
          dataNasc: true,
          email: true,
          telefone1: true,
          status: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
          especialidade: true,
          foto: true,
        },
      }),
      prisma.professor.findMany({
        where: { contaId },
        select: { id: true, cpf: true, email: true },
      }),
    ]);

    const byCpf = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const prof of professoresExistentes) {
      if (prof.cpf) byCpf.set(prof.cpf, prof.id);
      if (prof.email) byEmail.set(prof.email.toLowerCase(), prof.id);
    }

    for (const colab of colaboradores) {
      const cpf = colab.cpf ?? undefined;
      const email = colab.email ? colab.email.toLowerCase() : undefined;
      const telefone = colab.telefone1 ?? undefined;
      const exists = (cpf && byCpf.get(cpf)) || (email && byEmail.get(email)) || null;
      if (exists) continue;

      const hasRequired = Boolean(cpf && colab.dataNasc && email && telefone);
      if (!hasRequired) {
        continue;
      }

      const created = await prisma.professor.create({
        data: {
          contaId,
          nome: colab.nome,
          cpf: cpf!,
          dataNasc: colab.dataNasc!,
          email: email!,
          telefoneCel: telefone!,
          telefoneFixo: null,
          cep: colab.enderecoCep ?? null,
          logradouro: colab.enderecoLogradouro ?? null,
          numero: colab.enderecoNumero ?? null,
          complemento: colab.enderecoComplemento ?? null,
          bairro: colab.enderecoBairro ?? null,
          cidade: colab.enderecoCidade ?? null,
          uf: colab.enderecoUf ?? null,
          formacao: null,
          especialidades: colab.especialidade ? [colab.especialidade] : [],
          dataAdmissao: null,
          statusContratual: null,
          cargaHoraria: null,
          miniBio: null,
          foto: colab.foto ?? null,
          status: colab.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        },
      });
      if (cpf) byCpf.set(cpf, created.id);
      if (email) byEmail.set(email, created.id);
    }
  } catch (err) {
    console.error('[api/professores] sync colaboradores->professores falhou', err);
  }
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
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    const contaId = contaIdParam ?? sessionContaId;
    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (sessionContaId && contaId !== sessionContaId) {
      return jsonError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const status = url.searchParams.get('status') || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    await ensureProfessoresFromColaboradores(contaId);
    const where: Record<string, unknown> = {
      contaId,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { nome: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.professor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.professor.count({ where }),
    ]);
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
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    const contaId = data.contaId?.trim();
    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (sessionContaId && contaId !== sessionContaId) {
      return jsonError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
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
      const created = await prisma.professor.create({ data: toCreate });
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

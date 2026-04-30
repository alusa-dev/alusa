import { NextRequest, NextResponse } from 'next/server';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/src/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
// Import direto do source até a lib ser rebuildada
import {
  colaboradorSchema,
  type ColaboradorInput,
  statusColabEnum,
  cargoEnum,
} from '../../../../../packages/lib/src/schemas/colaborador';
import { create as createColab } from '../../../../../packages/lib/src/server/services/colaborador-service';

export async function GET(req: NextRequest) {
  // MULTI-TENANT: validar sessão e usar contaId da sessão
  const session = await getServerSession(authOptions);
  const contaId = (session as { user?: { contaId?: string } })?.user?.contaId;
  if (!contaId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const status = (searchParams.get('status') || '').trim().toUpperCase();
  const cargo = (searchParams.get('cargo') || '').trim().toUpperCase();
  const page = Math.max(1, Number(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '10')));

  const where: Record<string, any> = { contaId };
  const and: any[] = [];
  if (q) {
    and.push({
      OR: [
        { nome: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (status && statusColabEnum.options.includes(status as any)) {
    and.push({ status });
  }
  if (cargo && cargoEnum.options.includes(cargo as any)) {
    and.push({ cargo });
  }
  if (and.length > 0) (where as any).AND = and;

  const db = prisma as unknown as { colaborador: any };
  const [total, items] = await Promise.all([
    db.colaborador.count({ where }),
    db.colaborador.findMany({
      where,
      orderBy: { nome: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return NextResponse.json({ items, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  try {
    // MULTI-TENANT: validar sessão e usar contaId da sessão
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } })?.user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    console.log('📥 DADOS RECEBIDOS:', JSON.stringify(body, null, 2));
    // Normalização defensiva de máscara -> dígitos (coerente com schema)
    const toDigits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : v);
    const toDigitsOrNull = (v: unknown) => {
      if (v === '' || v == null) return null;
      return typeof v === 'string' ? v.replace(/\D/g, '') : v;
    };
    const norm = {
      ...body,
      cpf: toDigits(body?.cpf),
      telefone1: toDigits(body?.telefone1),
      contatoEmergenciaTelefone: toDigitsOrNull((body as any)?.contatoEmergenciaTelefone),
      enderecoCep: toDigits(body?.enderecoCep),
    } as Record<string, unknown>;

    const data = colaboradorSchema.parse(norm) as ColaboradorInput;
    console.log('✅ DADOS VALIDADOS:', JSON.stringify(data, null, 2));

    const created = await createColab({ ...data, contaId });
    console.log('🎉 COLABORADOR CRIADO:', created.id, created.nome);

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (e) {
    console.error('❌ ERRO DETALHADO:', e);

    // Se for erro de validação do Zod, retornar detalhes específicos
    if (e && typeof e === 'object' && 'issues' in e) {
      const zodError = e as { issues: Array<{ path: string[]; message: string; code: string }> };
      console.error('🔍 ERROS DE VALIDAÇÃO ZOD:', zodError.issues);
      const firstIssue = zodError.issues[0];
      if (firstIssue) {
        const fieldName = firstIssue.path.join('.');
        let message = `${fieldName}: ${firstIssue.message}`;
        if (/telefone/i.test(fieldName)) {
          message = 'telefone: Telefone inválido. Use o formato (00) 00000-0000.';
        }
        return NextResponse.json({ error: message, zodIssues: zodError.issues }, { status: 400 });
      }
    }

    // Erros de unicidade do Prisma tratados no service já trazem mensagens amigáveis
    const msg = e instanceof Error ? e.message : 'Erro ao criar colaborador';
    // Sinalizar especificamente duplicidade de CPF
    if (/colaborador cadastrado com este CPF/i.test(msg)) {
      return NextResponse.json(
        { error: 'Já existe um colaborador cadastrado com este CPF' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

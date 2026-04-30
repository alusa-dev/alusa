import { ProfessorCreateSchema, ProfessorUpdateSchema, ProfessorQuerySchema, type ProfessorCreateInput, type ProfessorUpdateInput, type ProfessorQueryInput } from '../../validators/professor';
import * as repo from '../repositories/professor-repo';
import type { ProfessorRecord } from '../repositories/professor-repo';

export type ListParams = { contaId: string } & ProfessorQueryInput;

export async function list(params: ListParams) {
  const parsed = ProfessorQuerySchema.parse(params);
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;
  const search = parsed.search?.trim() || undefined;
  return repo.list({ contaId: params.contaId, page, pageSize, search });
}

export async function get(id: string, contaId: string) {
  if (!id) throw new Error('id obrigatório');
  if (!contaId) throw new Error('contaId obrigatório');
  return repo.getById(id, contaId);
}

export type CreateResult = { ok: true; data: ProfessorRecord } | { ok: false; code: 'EMAIL_EM_USO' | 'ERRO_VALIDACAO' | 'ERRO_DESCONHECIDO'; message: string };

export async function create(contaId: string, data: ProfessorCreateInput): Promise<CreateResult> {
  try {
    const parsed = ProfessorCreateSchema.parse(data);
    // Construir payload do repo usando campos diretos
    const payload = {
      nome: parsed.nome,
      email: parsed.email ?? null,
      telefone: parsed.telefoneCel ?? null,
      bio: parsed.miniBio ?? null,
      status: 'ATIVO',
    };

    const created = await repo.create(contaId, payload);
    return { ok: true, data: created };
  } catch (err: unknown) {
    if (isPrismaP2002(err)) {
      return { ok: false, code: 'EMAIL_EM_USO', message: 'Email já está em uso.' };
    }
    if (isZodError(err)) {
      return { ok: false, code: 'ERRO_VALIDACAO', message: 'Dados inválidos.' };
    }
    return { ok: false, code: 'ERRO_DESCONHECIDO', message: 'Erro ao criar professor.' };
  }
}

export type UpdateResult = { ok: true; data: ProfessorRecord } | { ok: false; code: 'EMAIL_EM_USO' | 'ERRO_VALIDACAO' | 'NAO_ENCONTRADO' | 'ERRO_DESCONHECIDO'; message: string };

export async function update(id: string, contaId: string, data: ProfessorUpdateInput): Promise<UpdateResult> {
  try {
    const parsed = ProfessorUpdateSchema.parse(data);

    const payload = {
      ...(parsed.nome ? { nome: parsed.nome } : {}),
      ...(parsed.email !== undefined ? { email: parsed.email } : {}),
      ...(parsed.telefoneCel !== undefined ? { telefone: parsed.telefoneCel } : {}),
      ...(parsed.miniBio !== undefined ? { bio: parsed.miniBio } : {}),
      ...(parsed.status ? { status: parsed.status } : {}),
    };

    const exists = await repo.getById(id, contaId);
    if (!exists) return { ok: false, code: 'NAO_ENCONTRADO', message: 'Professor não encontrado.' };

    const updated = await repo.update(id, contaId, payload);
    return { ok: true, data: updated };
  } catch (err: unknown) {
    if (isPrismaP2002(err)) {
      return { ok: false, code: 'EMAIL_EM_USO', message: 'Email já está em uso.' };
    }
    if (isZodError(err)) {
      return { ok: false, code: 'ERRO_VALIDACAO', message: 'Dados inválidos.' };
    }
    return { ok: false, code: 'ERRO_DESCONHECIDO', message: 'Erro ao atualizar professor.' };
  }
}

export type RemoveResult = { ok: true; data: ProfessorRecord } | { ok: false; code: 'NAO_ENCONTRADO' | 'ERRO_DESCONHECIDO'; message: string };

export async function remove(id: string, contaId: string): Promise<RemoveResult> {
  try {
    const exists = await repo.getById(id, contaId);
    if (!exists) return { ok: false, code: 'NAO_ENCONTRADO', message: 'Professor não encontrado.' };

    const removed = await repo.remove(id);
    return { ok: true, data: removed };
  } catch {
    return { ok: false, code: 'ERRO_DESCONHECIDO', message: 'Erro ao remover professor.' };
  }
}

// Helpers
function isPrismaP2002(e: unknown): boolean {
  return !!(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002');
}
function isZodError(e: unknown): boolean {
  return !!(e && typeof e === 'object' && 'issues' in e);
}

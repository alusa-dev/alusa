import { describe, expect, it, vi } from 'vitest';

import {
  createCentroCusto,
  deleteCentroCusto,
  findDuplicateCentroCusto,
  getCentroCusto,
  listCentroCustos,
  updateCentroCusto,
  updateCentroCustoStatus,
} from './centro-custo.service';

function makeDb() {
  return {
    centroCusto: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cc-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('centro-custo.service', () => {
  it('mantém contaId em listagem e filtros opcionais', async () => {
    const db = makeDb();

    await listCentroCustos('conta-a', { tipo: 'DESPESA', status: 'ATIVO' }, db as never);

    expect(db.centroCusto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contaId: 'conta-a', tipo: 'DESPESA', status: 'ATIVO' },
      }),
    );
  });

  it('mantém contaId em leituras, duplicidade e escrita', async () => {
    const db = makeDb();
    const input = { nome: 'Mensalidade', tipo: 'RECEITA' as const, descricao: null, status: 'ATIVO' as const };

    await getCentroCusto('conta-a', 'cc-1', db as never);
    await findDuplicateCentroCusto('conta-a', input, 'cc-2', db as never);
    await createCentroCusto('conta-a', input, db as never);
    await updateCentroCusto('conta-a', 'cc-1', input, 'ATIVO', db as never);
    await updateCentroCustoStatus('conta-a', 'cc-1', { status: 'INATIVO' }, db as never);
    await deleteCentroCusto('conta-a', 'cc-1', db as never);

    expect(db.centroCusto.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'cc-1', contaId: 'conta-a' } }),
    );
    expect(db.centroCusto.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { contaId: 'conta-a', nome: 'Mensalidade', tipo: 'RECEITA', NOT: { id: 'cc-2' } },
      }),
    );
    expect(db.centroCusto.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contaId: 'conta-a' }) }),
    );
    expect(db.centroCusto.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'cc-1', contaId: 'conta-a' } }),
    );
    expect(db.centroCusto.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'cc-1', contaId: 'conta-a' } }),
    );
    expect(db.centroCusto.deleteMany).toHaveBeenCalledWith({ where: { id: 'cc-1', contaId: 'conta-a' } });
  });
});

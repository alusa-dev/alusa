import { describe, it, expect } from 'vitest';
import { normalizeCombo } from '@/features/cadastro/combos/services/combos-service';

describe('combos-service normalizeCombo', () => {
  it('normaliza campos obrigatórios e opcionais', () => {
    const combo = normalizeCombo({
      id: '1',
      contaId: 'c1',
      nome: 'Combo Gold',
      descricao: 'Desc',
      valor: 150,
      periodicidade: 'MENSAL',
      status: 'ATIVO',
      vagasLimite: 20,
      turmas: [{ id: 't1', nome: 'Turma 1' }],
    });
    expect(combo.nome).toBe('Combo Gold');
    expect(combo.valor).toBe(150);
    expect(combo.periodicidade).toBe('MENSAL');
    expect(combo.turmas).toHaveLength(1);
  });

  it('aplica defaults e coerções', () => {
    const combo = normalizeCombo({
      id: 2,
      contaId: 'c2',
      nome: 'X',
      valor: '99.9',
      turmas: [],
    });
    expect(combo.id).toBe('2');
    expect(combo.valor).toBe(99.9);
    expect(combo.periodicidade).toBe('MENSAL');
    expect(combo.status).toBe('ATIVO');
  });
});

import { describe, expect, it } from 'vitest';
import { createContratoModeloSchema } from '@/features/contratos/schemas';

const base = {
  nome: 'Contrato de matrícula 2026',
  arquivoPdfUrl: '/uploads/contrato.pdf',
  hashSha256: 'a'.repeat(64),
  campos: [
    { tipo: 'ASSINATURA' as const, papel: 'ESCOLA' as const, pagina: 1, x: 0.1, y: 0.8, largura: 0.3, altura: 0.08 },
    { tipo: 'ASSINATURA' as const, papel: 'RESPONSAVEL_OU_ALUNO' as const, pagina: 1, x: 0.6, y: 0.8, largura: 0.3, altura: 0.08 },
  ],
};

describe('createContratoModeloSchema', () => {
  it('aceita os dois campos obrigatórios do MVP e aplica defaults', () => {
    const result = createContratoModeloSchema.parse(base);
    expect(result.campos).toHaveLength(2);
    expect(result.campos[0].obrigatorio).toBe(true);
    expect(result.campos[1].ordem).toBe(0);
  });

  it('recusa modelo sem campo da escola ou do responsável/aluno', () => {
    expect(() => createContratoModeloSchema.parse({
      ...base,
      campos: [base.campos[0]],
    })).toThrow();
  });

  it('recusa coordenada fora do intervalo normalizado', () => {
    expect(() => createContratoModeloSchema.parse({
      ...base,
      campos: base.campos.map((field) => ({ ...field, x: 1.1 })),
    })).toThrow();
  });
});

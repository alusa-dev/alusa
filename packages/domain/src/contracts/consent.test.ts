import { describe, expect, it } from 'vitest';
import {
  buildContractConsentPayload,
  resolveContractConsentAnswers,
  snapshotContractConsentTerms,
  renderContractConsentTemplate,
} from './consent';

const terms = snapshotContractConsentTerms([
  {
    id: 'term-image',
    codigo: 'IMAGE_USE',
    finalidade: 'IMAGE_USE',
    titulo: 'Uso de imagem',
    texto: 'Autorizo o uso da imagem do aluno.',
    papel: 'RESPONSAVEL_OU_ALUNO',
    obrigatorio: true,
    recusaImpedeAssinatura: false,
    ordem: 0,
  },
]);

describe('consentimentos de contrato', () => {
  it('permite recusar um consentimento sem bloquear a assinatura', () => {
    const resolved = resolveContractConsentAnswers(terms, [{ termId: 'term-image', decision: 'RECUSADO' }]);

    expect(buildContractConsentPayload(resolved)).toEqual([
      expect.objectContaining({ id: 'term-image', decision: 'RECUSADO' }),
    ]);
  });

  it('exige resposta para termos obrigatórios', () => {
    expect(() => resolveContractConsentAnswers(terms, [])).toThrow('CONTRACT_CONSENT_REQUIRED');
  });

  it('não aceita termo que não pertence ao snapshot', () => {
    expect(() => resolveContractConsentAnswers(terms, [{ termId: 'unknown', decision: 'AUTORIZADO' }])).toThrow('CONTRACT_CONSENT_UNKNOWN_TERM');
  });

  it('renderiza o template conforme o tipo de assinante', () => {
    expect(renderContractConsentTemplate(
      'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo a imagem de {{nome_aluno}}.',
      {
        signerType: 'RESPONSAVEL',
        signerName: 'Maria da Silva',
        signerCpf: '123',
        studentName: 'Pedro da Silva',
        studentCpf: '456',
        relationship: 'mãe',
      },
    )).toContain('na qualidade de mãe de Pedro da Silva');

    expect(renderContractConsentTemplate(
      'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo a imagem de {{nome_aluno}}.',
      {
        signerType: 'ALUNO_MAIOR',
        signerName: 'João da Silva',
        studentName: 'João da Silva',
      },
    )).toContain('na condição de titular da própria imagem');
  });

  it('congela template, versão, contexto e texto renderizado no snapshot', () => {
    const snapshot = snapshotContractConsentTerms([
      {
        ...terms[0],
        texto: 'Eu, {{nome_assinante}}, autorizo a imagem de {{nome_aluno}}.',
        templateId: 'template-1',
        templateVersao: 3,
      },
    ], {
      signerType: 'RESPONSAVEL',
      signerName: 'Maria da Silva',
      signerCpf: '123',
      studentName: 'Pedro da Silva',
      studentCpf: '456',
      relationship: 'mãe',
    });

    expect(snapshot[0]).toEqual(expect.objectContaining({
      templateId: 'template-1',
      templateVersao: 3,
      texto: 'Eu, Maria da Silva, autorizo a imagem de Pedro da Silva.',
      contexto: expect.objectContaining({ signerType: 'RESPONSAVEL' }),
    }));
  });
});

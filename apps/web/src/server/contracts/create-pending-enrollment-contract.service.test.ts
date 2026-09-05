import { describe, expect, it, vi } from 'vitest';
import {
  createPendingEnrollmentContract,
  EnrollmentContractModelNotFoundError,
  EnrollmentContractModelSignatureFieldsError,
} from './create-pending-enrollment-contract.service';

function buildTx(modelExists = true) {
  return {
    contratoModelo: {
      findFirst: vi.fn().mockResolvedValue(
        modelExists
          ? {
              id: 'modelo-1',
              arquivoPdfUrl: 'https://files/modelo.pdf',
              arquivoOriginalUrl: null,
              hashSha256: 'hash',
              tamanhoBytes: 123,
              mimeType: 'application/pdf',
              campos: [
                { papel: 'ESCOLA', obrigatorio: true, ordem: 0 },
                { papel: 'RESPONSAVEL_OU_ALUNO', obrigatorio: true, ordem: 1 },
              ],
              consentimentos: [
                {
                  id: 'consent-1',
                  codigo: 'IMAGE_USE',
                  finalidade: 'IMAGE_USE',
                  titulo: 'Uso de imagem',
                  texto: 'Eu, {{nome_assinante}}, autorizo a imagem de {{nome_aluno}}.',
                  papel: 'RESPONSAVEL_OU_ALUNO',
                  obrigatorio: true,
                  recusaImpedeAssinatura: false,
                  ordem: 0,
                  templateId: 'template-1',
                  templateVersao: 2,
                },
              ],
            }
          : null,
      ),
    },
    contrato: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'contrato-1' }),
    },
    contratoDocumento: { create: vi.fn().mockResolvedValue({ id: 'documento-1' }) },
    contractEvidence: { create: vi.fn().mockResolvedValue({ id: 'evidencia-1' }) },
    matricula: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'matricula-1',
        aluno: {
          nome: 'Aluno Teste',
          cpf: null,
          dataNasc: new Date('2010-01-01'),
          responsaveis: [],
        },
        responsavelFinanceiro: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('createPendingEnrollmentContract', () => {
  it('cria documento, evidências e liga o contrato à matrícula na mesma unidade de trabalho', async () => {
    const tx = buildTx();
    const result = await createPendingEnrollmentContract(tx as never, {
      contaId: 'conta-1',
      matriculaId: 'matricula-1',
      modeloId: 'modelo-1',
      actorId: 'usuario-1',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'contrato-1', publicToken: expect.any(String) }));
    expect(tx.contrato.create).toHaveBeenCalledOnce();
    expect(tx.contrato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenPublico: expect.stringMatching(/^hash:/),
          tokenPublicoHash: expect.any(String),
          camposAssinaturaSnapshot: expect.arrayContaining([
            expect.objectContaining({ papel: 'ESCOLA', ordem: 0 }),
            expect.objectContaining({ papel: 'RESPONSAVEL_OU_ALUNO', ordem: 1 }),
          ]),
          termosConsentimentoSnapshot: [
            expect.objectContaining({
              templateId: 'template-1',
              templateVersao: 2,
              texto: 'Eu, responsável legal, autorizo a imagem de Aluno Teste.',
              contexto: expect.objectContaining({ signerType: 'RESPONSAVEL' }),
            }),
          ],
        }),
      }),
    );
    expect(tx.contratoDocumento.create).toHaveBeenCalledOnce();
    expect(tx.contractEvidence.create).toHaveBeenCalledTimes(2);
    expect(tx.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'matricula-1', contaId: 'conta-1' },
      }),
    );
  });

  it('registra notificação de contrato para responsável menor de idade', async () => {
    const tx = buildTx();
    tx.matricula.findFirst.mockResolvedValue({
      id: 'matricula-1',
      aluno: {
        nome: 'Aluno Menor',
        cpf: null,
        dataNasc: new Date('2015-01-01'),
        telefone: null,
        responsaveis: [{ tipoVinculo: 'PRINCIPAL', responsavel: {
          nome: 'Responsável',
          cpf: null,
          telefone: '+55 (97) 98128-3106',
          consentimentoComunicacoes: true,
          dataConsentimentoComunicacoes: new Date('2026-09-05T12:00:00.000Z'),
          versaoConsentimentoComunicacoes: '2026-09-05',
          origemConsentimentoComunicacoes: 'ALUNO_WIZARD',
        } }],
      },
      responsavelFinanceiro: null,
    });
    const txWithNotification = tx as typeof tx & { contractWhatsAppNotification: { create: ReturnType<typeof vi.fn> } };
    txWithNotification.contractWhatsAppNotification = { create: vi.fn().mockResolvedValue({ id: 'notification-1' }) };

    await createPendingEnrollmentContract(tx as never, {
      contaId: 'conta-1',
      matriculaId: 'matricula-1',
      modeloId: 'modelo-1',
      actorId: 'usuario-1',
    });

    expect(txWithNotification.contractWhatsAppNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientType: 'RESPONSAVEL',
          templateName: 'contrato_matricula_menor_18',
          languageCode: 'pt_BR',
        }),
      }),
    );
  });

  it('falha antes de escrever quando o modelo não pertence à conta', async () => {
    const tx = buildTx(false);
    await expect(
      createPendingEnrollmentContract(tx as never, {
        contaId: 'conta-1',
        matriculaId: 'matricula-1',
        modeloId: 'modelo-outra-conta',
        actorId: 'usuario-1',
      }),
    ).rejects.toBeInstanceOf(EnrollmentContractModelNotFoundError);
    expect(tx.contrato.create).not.toHaveBeenCalled();
  });

  it('falha antes de escrever quando o modelo não possui os campos obrigatórios', async () => {
    const tx = buildTx();
    tx.contratoModelo.findFirst.mockResolvedValueOnce({
      arquivoPdfUrl: 'https://files/modelo.pdf',
      arquivoOriginalUrl: null,
      hashSha256: 'hash',
      tamanhoBytes: 123,
      mimeType: 'application/pdf',
      campos: [{ papel: 'ESCOLA', obrigatorio: true, ordem: 0 }],
    });

    await expect(
      createPendingEnrollmentContract(tx as never, {
        contaId: 'conta-1',
        matriculaId: 'matricula-1',
        modeloId: 'modelo-1',
        actorId: 'usuario-1',
      }),
    ).rejects.toBeInstanceOf(EnrollmentContractModelSignatureFieldsError);
    expect(tx.contrato.create).not.toHaveBeenCalled();
  });
});

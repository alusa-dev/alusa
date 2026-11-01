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
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
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
    conta: { findUnique: vi.fn().mockResolvedValue({ contractNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractEmailNotificationsEnabled: false }) },
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
          contaId: 'conta-1',
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

  it('não enfileira contrato quando a conta desativa o WhatsApp digital', async () => {
    const tx = buildTx();
    tx.conta.findUnique.mockResolvedValue({ contractWhatsAppNotificationsEnabled: false });
    tx.matricula.findFirst.mockResolvedValue({
      id: 'matricula-1',
      aluno: {
        nome: 'Aluno Menor', cpf: null, dataNasc: new Date('2015-01-01'), telefone: null,
        responsaveis: [{ tipoVinculo: 'PRINCIPAL', responsavel: {
          nome: 'Responsável', cpf: null, telefone: '+55 (97) 98128-3106',
          consentimentoComunicacoes: true,
          dataConsentimentoComunicacoes: new Date('2026-09-05T12:00:00.000Z'),
          versaoConsentimentoComunicacoes: '2026-09-05', origemConsentimentoComunicacoes: 'ALUNO_WIZARD',
        } }],
      },
      responsavelFinanceiro: null,
    });
    const notification = { create: vi.fn() };
    (tx as typeof tx & { contractWhatsAppNotification: typeof notification }).contractWhatsAppNotification = notification;

    await createPendingEnrollmentContract(tx as never, {
      contaId: 'conta-1', matriculaId: 'matricula-1', modeloId: 'modelo-1', actorId: 'usuario-1',
    });

    expect(notification.create).not.toHaveBeenCalled();
  });

  it('enfileira o e-mail na emissão quando o canal da conta está ativo', async () => {
    const tx = buildTx();
    tx.conta.findUnique.mockResolvedValue({ contractNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractEmailNotificationsEnabled: true });
    tx.matricula.findFirst.mockResolvedValue({
      id: 'matricula-1',
      aluno: { nome: 'Aluno Menor', cpf: null, dataNasc: new Date('2015-01-01'), email: null, telefone: null, responsaveis: [] },
      responsavelFinanceiro: { contaId: 'conta-1', nome: 'Responsável Teste', cpf: null, email: 'responsavel@example.com', telefone: null, consentimentoComunicacoes: false },
    });
    const upsert = vi.fn().mockResolvedValue({ id: 'email-notification-1' });
    (tx as typeof tx & { contractEmailNotification: { upsert: typeof upsert } }).contractEmailNotification = { upsert };

    await createPendingEnrollmentContract(tx as never, { contaId: 'conta-1', matriculaId: 'matricula-1', modeloId: 'modelo-1', actorId: 'usuario-1' });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_contract_email_notification_delivery: { contaId: 'conta-1', deliveryKey: 'contract:contrato-1:email:issued' } },
      create: expect.objectContaining({ recipientEmail: 'responsavel@example.com', recipientName: 'Responsável Teste', tokenPublicoHash: expect.any(String) }),
    }));
  });

  it('não usa responsável de outra conta ao escolher destinatário de contrato', async () => {
    const tx = buildTx();
    tx.conta.findUnique.mockResolvedValue({ contractNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractEmailNotificationsEnabled: true });
    tx.matricula.findFirst.mockResolvedValue({
      id: 'matricula-1',
      aluno: { nome: 'Aluno Menor', cpf: null, dataNasc: new Date('2015-01-01'), email: null, telefone: null, responsaveis: [{ tipoVinculo: 'PRINCIPAL', responsavel: { contaId: 'outra-conta', nome: 'Responsável externo', cpf: null, email: 'externo@example.com', telefone: '+55 (11) 99999-9999', consentimentoComunicacoes: true } }] },
      responsavelFinanceiro: { contaId: 'outra-conta', nome: 'Responsável externo', cpf: null, email: 'externo@example.com', telefone: '+55 (11) 99999-9999', consentimentoComunicacoes: true },
    });
    const whatsappCreate = vi.fn();
    const emailUpsert = vi.fn();
    (tx as typeof tx & { contractWhatsAppNotification: { create: typeof whatsappCreate }; contractEmailNotification: { upsert: typeof emailUpsert } }).contractWhatsAppNotification = { create: whatsappCreate };
    (tx as typeof tx & { contractEmailNotification: { upsert: typeof emailUpsert } }).contractEmailNotification = { upsert: emailUpsert };

    await createPendingEnrollmentContract(tx as never, { contaId: 'conta-1', matriculaId: 'matricula-1', modeloId: 'modelo-1', actorId: 'usuario-1' });

    expect(whatsappCreate).not.toHaveBeenCalled();
    expect(emailUpsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'CONTRACT_EMAIL_NOT_ENQUEUED_NO_TENANT_RECIPIENT', metadata: expect.objectContaining({ reason: 'CANONICAL_EMAIL_UNAVAILABLE' }) }) }));
  });

  it('não cria outbox pendente quando o e-mail canônico está ausente', async () => {
    const tx = buildTx();
    tx.conta.findUnique.mockResolvedValue({ contractNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractEmailNotificationsEnabled: true });
    tx.matricula.findFirst.mockResolvedValue({ id: 'matricula-1', aluno: { nome: 'Aluno Adulto', cpf: null, dataNasc: new Date('1990-01-01'), email: '   ', telefone: null, responsaveis: [] }, responsavelFinanceiro: null });
    const emailUpsert = vi.fn();
    (tx as typeof tx & { contractEmailNotification: { upsert: typeof emailUpsert } }).contractEmailNotification = { upsert: emailUpsert };

    await createPendingEnrollmentContract(tx as never, { contaId: 'conta-1', matriculaId: 'matricula-1', modeloId: 'modelo-1', actorId: 'usuario-1' });

    expect(emailUpsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'CONTRACT_EMAIL_NOT_ENQUEUED_NO_TENANT_RECIPIENT' }) }));
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

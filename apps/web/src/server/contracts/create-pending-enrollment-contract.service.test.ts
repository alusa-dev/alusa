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
    matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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

    expect(result).toEqual({ id: 'contrato-1' });
    expect(tx.contrato.create).toHaveBeenCalledOnce();
    expect(tx.contrato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          camposAssinaturaSnapshot: expect.arrayContaining([
            expect.objectContaining({ papel: 'ESCOLA', ordem: 0 }),
            expect.objectContaining({ papel: 'RESPONSAVEL_OU_ALUNO', ordem: 1 }),
          ]),
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

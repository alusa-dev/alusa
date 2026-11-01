import { describe, expect, it } from 'vitest';
import { resolveContractWhatsAppTemplateRecipient } from './contract-whatsapp-template-recipient';

describe('contract WhatsApp template recipient', () => {
  const base = {
    contaId: 'conta-a',
    recipientType: 'RESPONSAVEL',
    recipientPhone: '+5511999999999',
    student: { contaId: 'conta-a', nome: 'Aluno A', telefone: null },
    financialResponsible: null,
    linkedResponsible: null,
  };

  it('does not use a linked or financial responsible from another tenant even with the same phone', () => {
    expect(resolveContractWhatsAppTemplateRecipient({
      ...base,
      financialResponsible: { contaId: 'conta-b', nome: 'Responsável B', telefone: '+55 (11) 99999-9999' },
      linkedResponsible: { contaId: 'conta-b', nome: 'Responsável B', telefone: '+55 (11) 99999-9999' },
    })).toBeNull();
  });

  it('rejects student records outside the contract tenant', () => {
    expect(resolveContractWhatsAppTemplateRecipient({
      ...base,
      student: { contaId: 'conta-b', nome: 'Aluno B', telefone: null },
      linkedResponsible: { contaId: 'conta-a', nome: 'Responsável A', telefone: '+55 (11) 99999-9999' },
    })).toBeNull();
  });

  it('uses only a matching canonical responsible from the current tenant', () => {
    expect(resolveContractWhatsAppTemplateRecipient({
      ...base,
      financialResponsible: { contaId: 'conta-a', nome: 'Responsável A', telefone: '+55 (11) 99999-9999' },
    })).toEqual({ recipientName: 'Responsável A', studentName: 'Aluno A' });
  });
});

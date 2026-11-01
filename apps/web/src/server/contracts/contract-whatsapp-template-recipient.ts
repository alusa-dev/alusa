import { normalizeBrazilianWhatsAppPhone } from '@alusa/whatsapp';

type Recipient = { contaId: string; nome: string | null; telefone: string | null };

function samePhone(a: string | null | undefined, b: string) {
  if (!a) return false;
  try {
    return normalizeBrazilianWhatsAppPhone(a) === normalizeBrazilianWhatsAppPhone(b);
  } catch {
    return false;
  }
}

export function resolveContractWhatsAppTemplateRecipient(input: {
  contaId: string;
  recipientType: string;
  recipientPhone: string;
  student: { contaId: string; nome: string; telefone: string | null };
  financialResponsible: Recipient | null;
  linkedResponsible: Recipient | null;
}) {
  if (input.student.contaId !== input.contaId) return null;

  if (input.recipientType === 'ALUNO') {
    return samePhone(input.student.telefone, input.recipientPhone)
      ? { recipientName: input.student.nome, studentName: input.student.nome }
      : null;
  }
  if (input.recipientType !== 'RESPONSAVEL') return null;

  const responsible = [input.financialResponsible, input.linkedResponsible].find((candidate) =>
    candidate?.contaId === input.contaId && samePhone(candidate.telefone, input.recipientPhone),
  );
  if (!responsible) return null;
  return { recipientName: responsible.nome || 'responsável legal', studentName: input.student.nome };
}

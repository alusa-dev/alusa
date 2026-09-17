import { prisma } from '@/lib/prisma';

export function getStudentPaymentPerson(input: { contaId: string; alunoId: string }) {
  return prisma.aluno.findFirst({
    where: { id: input.alunoId, contaId: input.contaId },
    select: { id: true, nome: true, email: true, telefone: true, cpf: true, foto: true },
  });
}

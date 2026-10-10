import { decideEnrollmentStatusAtContractStart, validateTransition } from '@alusa/domain';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  assertStudentCapacity,
  countAdditionalActiveStudentsForEnrollment,
} from '@/src/server/platform-billing/capacity';

const MAX_TRANSITION_ATTEMPTS = 3;

/** Apply the academic transition when a scheduled enrollment reaches its start date. */
export async function activateEnrollmentAtContractStart(input: {
  contaId: string;
  matriculaId: string;
}) {
  return runWithTenant(input.contaId, async (tx) => {
    for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS; attempt += 1) {
      const [account, enrollment] = await Promise.all([
        tx.conta.findFirst({
          where: { id: input.contaId },
          select: { matriculaActivationPolicy: true },
        }),
        tx.matricula.findFirst({
          where: { id: input.matriculaId, contaId: input.contaId },
          select: {
            alunoId: true,
            status: true,
            taxaIsenta: true,
            taxaMatricula: true,
            taxaStatus: true,
          },
        }),
      ]);
      if (!enrollment) throw new Error('MATRICULA_NAO_ENCONTRADA_AO_ATIVAR_INICIO_FUTURO');

      const feeRequired = !enrollment.taxaIsenta && Number(enrollment.taxaMatricula) > 0;
      const decision = decideEnrollmentStatusAtContractStart({
        activationPolicy: account?.matriculaActivationPolicy ?? 'IMMEDIATE',
        enrollmentStatus: enrollment.status,
        feeRequired,
        feeStatus: enrollment.taxaStatus,
      });
      if (decision.action === 'KEEP') return decision;

      const transition = validateTransition(enrollment.status, decision.targetStatus);
      if (!transition.success) {
        throw new Error(`MATRICULA_TRANSICAO_INICIO_INVALIDA:${transition.error}`);
      }

      if (decision.targetStatus === 'ATIVA') {
        const additionalActiveStudents = await countAdditionalActiveStudentsForEnrollment({
          tx,
          contaId: input.contaId,
          alunoId: enrollment.alunoId,
        });
        await assertStudentCapacity({
          tx,
          contaId: input.contaId,
          additionalActiveStudents,
          operation: 'enrollment.scheduled-start.activate',
        });
      }

      const updated = await tx.matricula.updateMany({
        where: {
          id: input.matriculaId,
          contaId: input.contaId,
          status: enrollment.status,
          taxaStatus: enrollment.taxaStatus,
        },
        data: { status: decision.targetStatus },
      });
      if (updated.count === 1) return decision;
    }

    throw new Error('MATRICULA_ATIVACAO_CONCORRENTE_RETRY');
  });
}

/** Filters older unmapped enrollments to the course being classified. */
export function buildUnmappedPriorEnrollmentWhere(input: {
  contaId: string;
  alunoId: string;
  currentMatriculaId: string;
  modalidadeId: string;
}) {
  return {
    contaId: input.contaId,
    alunoId: input.alunoId,
    id: { not: input.currentMatriculaId },
    vinculosAcademicos: { none: {} },
    OR: [
      { turma: { is: { modalidadeId: input.modalidadeId } } },
      { matriculaTurmas: { some: { turma: { is: { modalidadeId: input.modalidadeId } } } } },
    ],
  };
}

/** Finds legacy enrollments in one course that have no academic link for that course. */
export function buildUnmappedPriorEnrollmentInCourseWhere(input: {
  contaId: string;
  alunoId: string;
  currentMatriculaId: string;
  modalidadeId: string;
}) {
  return {
    contaId: input.contaId,
    alunoId: input.alunoId,
    id: { not: input.currentMatriculaId },
    vinculosAcademicos: { none: { modalidadeId: input.modalidadeId } },
    OR: [
      { turma: { is: { modalidadeId: input.modalidadeId } } },
      { matriculaTurmas: { some: { turma: { is: { modalidadeId: input.modalidadeId } } } } },
    ],
  };
}

export function wasCancelledBeforeEffectiveStart(input: {
  status: string;
  cancelledAt: Date | null;
  dataInicio: Date;
}) {
  return input.status === 'CANCELADA' && input.cancelledAt != null && input.cancelledAt <= input.dataInicio;
}

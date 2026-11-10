export type EnrollmentClassification =
  | 'PRIMEIRO_INGRESSO'
  | 'REMATRICULA'
  | 'RETORNO'
  | 'TRANSFERENCIA'
  | 'HISTORICO_INDETERMINADO';

export type EnrollmentClassificationInput = {
  formalTransfer: boolean;
  pendingTransferWithEvidence: boolean;
  historyReliable: boolean;
  hasEffectiveEnrollmentInCourse: boolean;
  definitiveBreak: boolean;
  provenUnjustifiedGap: boolean;
  immediatelyNextCycle: boolean;
};

export type EnrollmentClassificationReason = 'TRANSFER_FORMALIZADA' | 'TRANSFERENCIA_PENDENTE' | 'HISTORICO_INSUFICIENTE' | 'RUPTURA_DEFINITIVA' | 'LACUNA_COMPROVADA' | 'CICLO_SEGUINTE' | 'PRIMEIRO_VINCULO' | 'HISTORICO_INCONSISTENTE';
export type EnrollmentClassificationDecision = {
  classification: EnrollmentClassification;
  reasonCode: EnrollmentClassificationReason;
};

/** Classifies an academic course link. Missing history is never evidence of absence. */
export function classifyEnrollment(input: EnrollmentClassificationInput): EnrollmentClassificationDecision {
  if (input.formalTransfer) return { classification: 'TRANSFERENCIA', reasonCode: 'TRANSFER_FORMALIZADA' };
  if (input.pendingTransferWithEvidence) return { classification: 'HISTORICO_INDETERMINADO', reasonCode: 'TRANSFERENCIA_PENDENTE' };
  if (!input.historyReliable) return { classification: 'HISTORICO_INDETERMINADO', reasonCode: 'HISTORICO_INSUFICIENTE' };
  if (input.definitiveBreak && !input.hasEffectiveEnrollmentInCourse) return { classification: 'HISTORICO_INDETERMINADO', reasonCode: 'HISTORICO_INCONSISTENTE' };
  if (input.definitiveBreak) return { classification: 'RETORNO', reasonCode: 'RUPTURA_DEFINITIVA' };
  if (input.provenUnjustifiedGap && !input.hasEffectiveEnrollmentInCourse) return { classification: 'HISTORICO_INDETERMINADO', reasonCode: 'HISTORICO_INCONSISTENTE' };
  if (input.provenUnjustifiedGap) return { classification: 'RETORNO', reasonCode: 'LACUNA_COMPROVADA' };
  if (input.immediatelyNextCycle && input.hasEffectiveEnrollmentInCourse) return { classification: 'REMATRICULA', reasonCode: 'CICLO_SEGUINTE' };
  if (!input.hasEffectiveEnrollmentInCourse) return { classification: 'PRIMEIRO_INGRESSO', reasonCode: 'PRIMEIRO_VINCULO' };
  return { classification: 'HISTORICO_INDETERMINADO', reasonCode: 'HISTORICO_INCONSISTENTE' };
}

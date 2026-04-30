export class ManualReviewRequiredError extends Error {
  readonly code = 'MANUAL_REVIEW_REQUIRED' as const;
  readonly groupId: string;

  constructor(params: { groupId: string; message?: string }) {
    super(
      params.message ??
        'Não foi possível preparar esta etapa de verificação para envio automático no momento.',
    );
    this.name = 'ManualReviewRequiredError';
    this.groupId = params.groupId;
  }
}

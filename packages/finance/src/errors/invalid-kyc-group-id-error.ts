export class InvalidKycGroupIdError extends Error {
  readonly code = 'INVALID_GROUP_ID' as const;
  readonly groupId: string;

  constructor(groupId: string, message = 'Grupo de documentos inválido ou inexistente.') {
    super(message);
    this.name = 'InvalidKycGroupIdError';
    this.groupId = groupId;
  }
}

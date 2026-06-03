export type CreateSignatureRequestInput = {
  contaId: string;
  contratoId: string;
  matriculaId: string;
};

export type CreateSignatureRequestResult = {
  provider: 'ALUSA_INTERNAL';
  status: 'CREATED';
};

export type SignContractInput = {
  contaId: string;
  contratoId: string;
};

export type SignContractResult = {
  provider: 'ALUSA_INTERNAL';
  status: 'SIGNED';
};

export type CancelSignatureInput = {
  contaId: string;
  contratoId: string;
  reason?: string | null;
};

export type SignatureWebhookEvent = {
  provider: string;
  type: string;
  payload: unknown;
};

export interface SignatureProvider {
  createSignatureRequest(_input: CreateSignatureRequestInput): Promise<CreateSignatureRequestResult>;
  sign(_input: SignContractInput): Promise<SignContractResult>;
  cancel(_input: CancelSignatureInput): Promise<void>;
  parseWebhook?(_payload: unknown): Promise<SignatureWebhookEvent>;
}

export class AlusaInternalSignatureProvider implements SignatureProvider {
  async createSignatureRequest(_input: CreateSignatureRequestInput): Promise<CreateSignatureRequestResult> {
    return { provider: 'ALUSA_INTERNAL', status: 'CREATED' };
  }

  async sign(_input: SignContractInput): Promise<SignContractResult> {
    return { provider: 'ALUSA_INTERNAL', status: 'SIGNED' };
  }

  async cancel(_input: CancelSignatureInput): Promise<void> {
    return undefined;
  }
}

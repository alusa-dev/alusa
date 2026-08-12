import { describe, expect, it } from 'vitest';
import type { AsaasMyAccountDocumentGroup } from '@alusa/asaas';

import {
  resolveNextActionFromLiveGroup,
} from '../kyc-document-group-resolver';

const interfaceOnlyDescription = 'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.';

function group(overrides: Partial<AsaasMyAccountDocumentGroup> = {}): AsaasMyAccountDocumentGroup {
  return {
    id: 'group-1',
    status: 'NOT_SENT',
    type: 'IDENTIFICATION',
    title: 'Documento de identificação',
    description: 'Envie o documento',
    documents: [],
    ...overrides,
  };
}

describe('resolveNextActionFromLiveGroup', () => {
  it('deriva PROVIDER_PORTAL_REQUIRED para grupo interface-only sem tentar upload', () => {
    const action = resolveNextActionFromLiveGroup(group({ description: interfaceOnlyDescription }), null);

    expect(action).toMatchObject({
      kind: 'PROVIDER_PORTAL_REQUIRED',
      groupId: 'group-1',
      submissionMethod: 'PROVIDER_PORTAL',
    });
  });

  it('prioriza onboardingUrl quando o grupo possui link válido', () => {
    const action = resolveNextActionFromLiveGroup(group({
      onboardingUrl: 'https://asaas.example/onboarding/group-1',
      onboardingUrlExpirationDate: '2099-01-01T00:00:00.000Z',
    }), null);

    expect(action).toMatchObject({
      kind: 'EXTERNAL_ONBOARDING',
      onboardingUrl: 'https://asaas.example/onboarding/group-1',
    });
  });

  it('não expõe onboardingUrl expirado e aguarda a regeneração pelo provedor', () => {
    const action = resolveNextActionFromLiveGroup(group({
      status: 'REJECTED',
      onboardingUrl: 'https://asaas.example/onboarding/expired',
      onboardingUrlExpirationDate: '2020-01-01T00:00:00.000Z',
    }), null);

    expect(action).toMatchObject({
      kind: 'WAITING_PROVIDER',
      groupStatus: 'REJECTED',
    });
    expect(action?.onboardingUrl).toBeUndefined();
  });
});

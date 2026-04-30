import { recordAsaasReadIntent } from '@alusa/finance';

type ReadScope =
  | 'cobranca_detail'
  | 'portal_financeiro_detail'
  | 'matricula_detail'
  | 'payment_method_sync';

type ReadDecision = 'local' | 'remote' | 'fresh_remote';

type ScopeMetrics = {
  local: number;
  remote: number;
  freshRemote: number;
};

const scopes: Record<ReadScope, ScopeMetrics> = {
  cobranca_detail: { local: 0, remote: 0, freshRemote: 0 },
  portal_financeiro_detail: { local: 0, remote: 0, freshRemote: 0 },
  matricula_detail: { local: 0, remote: 0, freshRemote: 0 },
  payment_method_sync: { local: 0, remote: 0, freshRemote: 0 },
};

export function recordAsaasReadDecision(scope: ReadScope, decision: ReadDecision) {
  if (decision === 'local') scopes[scope].local += 1;
  if (decision === 'remote') {
    scopes[scope].remote += 1;
    recordAsaasReadIntent('READ_MODEL');
  }
  if (decision === 'fresh_remote') {
    scopes[scope].freshRemote += 1;
    recordAsaasReadIntent('READ_MODEL');
  }
}

export function getAsaasReadObservability() {
  return {
    cobrancaDetail: { ...scopes.cobranca_detail },
    portalFinanceiroDetail: { ...scopes.portal_financeiro_detail },
    matriculaDetail: { ...scopes.matricula_detail },
    paymentMethodSync: { ...scopes.payment_method_sync },
  };
}

export function resetAsaasReadObservability() {
  for (const scope of Object.values(scopes)) {
    scope.local = 0;
    scope.remote = 0;
    scope.freshRemote = 0;
  }
}

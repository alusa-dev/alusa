export type AsaasConnectionStatus = 'CONNECTED' | 'NOT_CONNECTED' | 'MISCONFIGURED';

export type AsaasConnectionReasonCode =
  | 'MISSING_CREDENTIALS'
  | 'INVALID_BASE_URL'
  | 'MISSING_API_KEY'
  | 'MISSING_ACCOUNT_ID';

export type AsaasConnectionDTO = {
  status: AsaasConnectionStatus;
  reasonCode?: AsaasConnectionReasonCode;
};

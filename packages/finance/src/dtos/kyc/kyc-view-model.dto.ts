export type KycGateStatus =
  | 'NOT_REQUIRED'
  | 'WAITING_REQUIREMENTS'
  | 'ACTION_REQUIRED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'REJECTED'
  | 'ERROR';

export type KycActionType = 'OPEN_EXTERNAL' | 'UPLOAD_INTERNAL' | 'WAIT' | 'NONE';

export type KycUiNextAction =
  | { type: 'NONE' }
  | { type: 'WAIT'; retryAfterSeconds: number; reason: 'INITIAL_DELAY' | 'CACHE_TTL' | 'RETRY' }
  | { type: 'OPEN_EXTERNAL'; url: string; label: string }
  | { type: 'UPLOAD_INTERNAL'; documentId: string; label: string };

export type KycDocumentItem = {
  uiId: string;
  id: string;
  title: string;
  description?: string;
  method: 'EXTERNAL' | 'INTERNAL';
  status: 'PENDING' | 'SENT' | 'APPROVED' | 'REJECTED' | 'UNKNOWN';
  external?: { url: string };
  internal?: { accept: string[]; maxSizeMb: number; types?: string[] };
};

export type KycViewModel = {
  gateStatus: KycGateStatus;
  documentsRequired: boolean;
  canUseProduct: boolean;
  blockingReason?: 'KYC_PENDING' | 'ACCOUNT_ANALYSIS' | 'NONE';
  pendingExternal: KycDocumentItem[];
  pendingInternal: KycDocumentItem[];
  completed: KycDocumentItem[];
  nextAction: KycUiNextAction;
  lastCheckedAt?: string;
  refreshHintSeconds?: number;
  message?: { title: string; body: string; tone: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' };
};

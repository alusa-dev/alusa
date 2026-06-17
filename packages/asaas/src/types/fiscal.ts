export type AsaasFiscalAuthenticationType = 'CERTIFICATE' | 'TOKEN' | 'USER_AND_PASSWORD';

export type AsaasFiscalMunicipalOptions = {
  authenticationType?: AsaasFiscalAuthenticationType;
  supportsCancellation?: boolean;
  usesSpecialTaxRegimes?: boolean;
  usesServiceListItem?: boolean;
  usesStateInscription?: boolean;
  usesNbs?: boolean;
  usesAedf?: boolean;
  specialTaxRegimesList?: Array<{ label: string; value: string }>;
  nationalPortalTaxCalculationRegimeList?: Array<{ label: string; value: string }>;
  nationalPortalTaxCalculationRegimeHelp?: string;
  municipalInscriptionHelp?: string;
  specialTaxRegimeHelp?: string;
  serviceListItemHelp?: string;
  digitalCertificatedHelp?: string;
  accessTokenHelp?: string;
  municipalServiceCodeHelp?: string;
  stateInscriptionHelp?: string;
  aedfHelp?: string;
};

export type AsaasFiscalInfo = {
  object?: string;
  email?: string;
  municipalInscription?: string;
  stateInscription?: string;
  aedf?: string | null;
  simplesNacional?: boolean;
  culturalProjectsPromoter?: boolean;
  cnae?: string;
  specialTaxRegime?: string;
  serviceListItem?: string;
  nbsCode?: string;
  rpsSerie?: string;
  rpsNumber?: number;
  loteNumber?: number;
  username?: string;
  passwordSent?: boolean;
  accessTokenSent?: boolean;
  certificateSent?: boolean;
  nationalPortalTaxCalculationRegime?: string;
  useNationalPortal?: boolean;
};

export type UpsertFiscalInfoInput = {
  email: string;
  simplesNacional: boolean;
  municipalInscription?: string;
  stateInscription?: string;
  aedf?: string;
  culturalProjectsPromoter?: boolean;
  cnae?: string;
  specialTaxRegime?: string;
  serviceListItem?: string;
  nbsCode?: string;
  rpsSerie?: string;
  rpsNumber?: number;
  loteNumber?: number;
  username?: string;
  password?: string;
  accessToken?: string;
  certificateFile?: Blob | File;
  certificatePassword?: string;
  nationalPortalTaxCalculationRegime?: string;
};

export type AsaasMunicipalService = {
  id?: string;
  description?: string;
  municipalServiceCode?: string;
  issTax?: number;
};

export type AsaasMunicipalServicesListResponse = {
  data?: AsaasMunicipalService[];
  totalCount?: number;
  hasMore?: boolean;
};

export type AsaasNbsCode = {
  nbsCode?: string;
  codeDescription?: string;
  /** Legado — preferir nbsCode. */
  code?: string;
  /** Legado — preferir codeDescription. */
  description?: string;
};

export type AsaasNbsCodesListResponse = {
  data?: AsaasNbsCode[];
  totalCount?: number;
  hasMore?: boolean;
};

export type AsaasFiscalCodeItem = {
  code?: string;
  description?: string;
  [key: string]: unknown;
};

export type AsaasFiscalCodeListResponse = {
  object?: 'list' | string;
  data?: AsaasFiscalCodeItem[];
  totalCount?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
};

export type ConfigureNationalPortalInput = {
  enabled: boolean;
};

export type ConfigureNationalPortalResponse = {
  success?: boolean;
};

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFiscalInfo, UpsertFiscalInfoInput } from '../types/fiscal';

export interface UpsertFiscalInfoParams {
  apiKey: string;
  data: UpsertFiscalInfoInput;
}

function buildFiscalInfoFormData(data: UpsertFiscalInfoInput): FormData {
  const form = new FormData();
  form.append('email', data.email);
  form.append('simplesNacional', String(data.simplesNacional));

  if (data.municipalInscription) form.append('municipalInscription', data.municipalInscription);
  if (data.stateInscription) form.append('stateInscription', data.stateInscription);
  if (data.aedf) form.append('aedf', data.aedf);
  if (data.culturalProjectsPromoter !== undefined) {
    form.append('culturalProjectsPromoter', String(data.culturalProjectsPromoter));
  }
  if (data.cnae) form.append('cnae', data.cnae);
  if (data.specialTaxRegime != null && data.specialTaxRegime !== '') {
    form.append('specialTaxRegime', data.specialTaxRegime);
  }
  if (data.serviceListItem) form.append('serviceListItem', data.serviceListItem);
  if (data.nbsCode) form.append('nbsCode', data.nbsCode);
  if (data.rpsSerie) form.append('rpsSerie', data.rpsSerie);
  if (data.rpsNumber != null) form.append('rpsNumber', String(data.rpsNumber));
  if (data.loteNumber != null) form.append('loteNumber', String(data.loteNumber));
  if (data.username) form.append('username', data.username);
  if (data.password) form.append('password', data.password);
  if (data.accessToken) form.append('accessToken', data.accessToken);
  if (data.certificateFile) form.append('certificateFile', data.certificateFile);
  if (data.certificatePassword) form.append('certificatePassword', data.certificatePassword);
  if (data.nationalPortalTaxCalculationRegime != null && data.nationalPortalTaxCalculationRegime !== '') {
    form.append('nationalPortalTaxCalculationRegime', data.nationalPortalTaxCalculationRegime);
  }

  return form;
}

export async function upsertFiscalInfo(params: UpsertFiscalInfoParams): Promise<AsaasFiscalInfo> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  const form = buildFiscalInfoFormData(params.data);
  return client.post<AsaasFiscalInfo>('/fiscalInfo', form);
}

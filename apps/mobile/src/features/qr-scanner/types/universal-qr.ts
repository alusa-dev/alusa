export type UniversalQrCodeKind = 'PIX' | 'BOLETO' | 'EVENT_TICKET' | 'ALUSA_LINK' | 'UNKNOWN';

export type UniversalQrTarget =
  | { type: 'EVENT_TICKET'; ticketCode: string }
  | { type: 'CHARGE'; chargeId: string };

export type UniversalQrResolution = {
  kind: UniversalQrCodeKind;
  title: string;
  message: string;
  displayValue?: string;
  target?: UniversalQrTarget;
};

import { isPossibleEventTicketCode, resolveUniversalQr } from './resolve-universal-qr';

describe('resolveUniversalQr', () => {
  it('identifica ingressos pelo código e por links com ticketCode', () => {
    expect(resolveUniversalQr('TICKET_1234567890').kind).toBe('EVENT_TICKET');
    expect(resolveUniversalQr('https://app.alusa.local/ticket?ticketCode=TICKET_ABC').target).toEqual({
      type: 'EVENT_TICKET',
      ticketCode: 'TICKET_ABC',
    });
  });

  it('identifica um payload Pix', () => {
    expect(resolveUniversalQr('000201010212br.gov.bcb.pix2563example').kind).toBe('PIX');
  });

  it('identifica códigos numéricos de cobrança bancária', () => {
    expect(resolveUniversalQr('00190500954014481606906809350314337370000000100').kind).toBe('BOLETO');
  });

  it('reconhece links internos de cobrança da Alusa', () => {
    expect(resolveUniversalQr('alusa://billing/charge/cobranca_123').target).toEqual({
      type: 'CHARGE',
      chargeId: 'cobranca_123',
    });
  });

  it('mantém links externos desconhecidos fora dos fluxos internos', () => {
    expect(resolveUniversalQr('https://example.com/qualquer-coisa').kind).toBe('UNKNOWN');
  });
});

describe('isPossibleEventTicketCode', () => {
  it('permite consultar códigos legados simples no servidor', () => {
    expect(isPossibleEventTicketCode('LEGACY-1234')).toBe(true);
  });

  it('não envia Pix ou links externos para a validação de ingressos', () => {
    expect(isPossibleEventTicketCode('000201br.gov.bcb.pix')).toBe(false);
    expect(isPossibleEventTicketCode('https://example.com/ticket')).toBe(false);
  });
});

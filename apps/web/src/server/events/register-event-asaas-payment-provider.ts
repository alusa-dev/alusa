import { registerEventAsaasPaymentProvider } from '@alusa/lib/events/event-asaas-payment-provider';
import { eventAsaasPaymentProvider } from '@alusa/finance';

let registered = false;

export function ensureEventAsaasPaymentProviderRegistered(): void {
  if (registered) return;
  registerEventAsaasPaymentProvider(eventAsaasPaymentProvider);
  registered = true;
}

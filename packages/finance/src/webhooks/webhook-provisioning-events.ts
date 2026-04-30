import { getHandledEvents } from './asaas-event-registry';

export const PROVISIONED_WEBHOOK_EVENTS = Object.freeze([...getHandledEvents()]);
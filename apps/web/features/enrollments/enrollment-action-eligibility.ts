export function canCancelEnrollment(status: string): boolean {
  return status === 'ATIVA' || status === 'PAUSADA' || status === 'AGUARDANDO_CONFIRMACAO';
}

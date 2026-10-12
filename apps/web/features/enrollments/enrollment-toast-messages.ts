type EnrollmentAction = 'cancelar' | 'pausar' | 'retomar' | 'excluir';

const TECHNICAL_TERMS = /asaas|webhooks?|reconcilia|provedor|assinatura|resultado incerto|provisionamento|sincroniza|integração|endpoint|idempot|payload|request|resposta do servidor|efeitos financeiros|operação financeira|processamento financeiro|serviço financeiro/i;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.trim() : '';
}

export function getEnrollmentActionErrorMessage(error: unknown, action: EnrollmentAction): string {
  const message = getErrorMessage(error);
  const normalized = message.toLocaleLowerCase('pt-BR');

  if (/reconcilia|resultado incerto|ainda está sendo confirmado|em processamento/.test(normalized)) {
    return 'Não foi possível atualizar as cobranças. A matrícula continua como estava.';
  }

  if (/assinatura vinculada|atualizar a assinatura|alteração financeira|operação financeira|asaas|webhook|serviço financeiro|provedor/.test(normalized)) {
    return 'Não foi possível atualizar as cobranças. A matrícula continua como estava.';
  }

  if (/não tem permissão|permissão negada|acesso negado/.test(normalized)) {
    return `Você não tem permissão para ${action} esta matrícula. Peça acesso a uma pessoa administradora da escola.`;
  }

  if (/não encontrada|não existe|foi removida/.test(normalized)) {
    return `Esta matrícula não está mais disponível. Atualize a página e confira a lista novamente.`;
  }

  if (message && !TECHNICAL_TERMS.test(message) && !/^(erro|falha) ao |^não foi possível .+\.$/i.test(message)) return message;

  return 'Não foi possível atualizar as cobranças. A matrícula continua como estava.';
}

export function getEnrollmentWarningMessage(message: string): string {
  const normalized = message.toLocaleLowerCase('pt-BR');
  if (/reconcilia|resultado incerto|em processamento|sincroniza|asaas|webhooks?|provedor|assinatura vinculada|efeitos financeiros|operação financeira/.test(normalized)) {
    return 'O ajuste das cobranças ainda está sendo confirmado. A matrícula foi atualizada e você pode conferir novamente em alguns minutos.';
  }
  return TECHNICAL_TERMS.test(message) ? 'Uma atualização das cobranças ainda está pendente. Confira novamente em alguns minutos.' : message;
}

export function getEnrollmentPendingMessage(): string {
  return 'O pedido de cancelamento ainda está sendo confirmado. A matrícula continua como estava. Aguarde alguns minutos e confira novamente; você não precisa fazer o pedido outra vez agora.';
}

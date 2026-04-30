'use client';

import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

interface LogFinanceiro {
  id: string;
  acao: string;
  createdAt: string;
  detalhes?: Record<string, unknown> | null;
  usuario?: {
    nome: string;
  } | null;
}

interface CobrancaNotificacoesProps {
  cobrancaId: string;
  logs: LogFinanceiro[];
}

// Mapeamento de ações técnicas para textos amigáveis
const acaoParaTextoAmigavel: Record<string, string> = {
  REENVIO_WHATSAPP: 'Notificação enviada via WhatsApp',
  REENVIO_EMAIL: 'E-mail de cobrança reenviado',
  REENVIO_SMS: 'SMS de cobrança enviado',
  ENVIO_WHATSAPP: 'Cobrança enviada via WhatsApp',
  ENVIO_EMAIL: 'Cobrança enviada por e-mail',
  ENVIO_SMS: 'Mensagem SMS enviada',
  ASAAS_EMAIL_AUTOMATICO: 'E-mail enviado automaticamente',
  ASAAS_SMS_AUTOMATICO: 'SMS enviado automaticamente',
  ASAAS_WHATSAPP_AUTOMATICO: 'WhatsApp enviado automaticamente',
};

const getTextoAmigavel = (acao: string): string => {
  return acaoParaTextoAmigavel[acao] || acao;
};

export function CobrancaNotificacoes({ cobrancaId, logs }: CobrancaNotificacoesProps) {
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Hoje às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Ontem às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return `Há ${diffDays} dias`;
    }

    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Separar logs automáticos do Asaas dos manuais
  const logsAutomaticos = logs.filter((log) => 
    log.acao.includes('ASAAS_') && log.acao.includes('_AUTOMATICO')
  );
  
  const logsManuais = logs.filter((log) => 
    !log.acao.includes('ASAAS_') || !log.acao.includes('_AUTOMATICO')
  );

  // Agrupar logs MANUAIS por tipo
  const logsAgrupados = {
    whatsapp: logsManuais.filter((log) => log.acao.includes('WHATSAPP')),
    email: logsManuais.filter((log) => log.acao.includes('EMAIL')),
    sms: logsManuais.filter((log) => log.acao.includes('SMS')),
    outros: logsManuais.filter(
      (log) =>
        !log.acao.includes('WHATSAPP') && !log.acao.includes('EMAIL') && !log.acao.includes('SMS'),
    ),
  };

  const temNotificacoes = logs.length > 0;
  const temNotificacoesAutomaticas = logsAutomaticos.length > 0;
  const temNotificacoesManuais = logsManuais.length > 0;

  return (
    <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header com espaçamento consistente */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Comunicações</h2>
          <p className="mt-1 text-sm text-gray-600">
            Histórico de envio de notificações ao responsável
          </p>
        </div>
      </div>

      {/* Histórico de notificações com espaçamento e tipografia consistentes */}
      <div className="px-6 py-5">
        {/* Card de notificações automáticas da plataforma financeira */}
        {temNotificacoesAutomaticas && (
          <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-blue-900 mb-2">
                  ✅ Notificações Enviadas Automaticamente
                </h3>
                <p className="text-sm text-blue-800 mb-4">
                  A plataforma financeira enviou automaticamente as seguintes notificações ao criar esta cobrança:
                </p>
                
                {/* Lista de notificações automáticas */}
                <div className="space-y-2">
                  {logsAutomaticos.map((log) => {
                    const isEmail = log.acao.includes('EMAIL');
                    const isSMS = log.acao.includes('SMS');
                    const isWhatsApp = log.acao.includes('WHATSAPP');
                    
                    return (
                      <div key={log.id} className="flex items-center justify-between bg-white/80 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">
                            {isEmail && '📧'}
                            {isSMS && '💬'}
                            {isWhatsApp && '📱'}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {isEmail && 'E-mail'}
                              {isSMS && 'SMS'}
                              {isWhatsApp && 'WhatsApp'}
                            </p>
                            <p className="text-xs text-slate-600">
                              {formatDate(log.createdAt)}
                            </p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                          <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                          <span className="text-xs font-medium text-green-700">Enviado</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mensagem quando não há notificações */}
        {!temNotificacoes ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex items-center justify-center w-16 h-16 mb-4 bg-gray-100 rounded-full">
              <ChatBubbleLeftRightIcon className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-base font-medium text-gray-900">Nenhum envio registrado</p>
            <p className="mt-1 text-sm text-gray-600">
              Os envios automáticos da plataforma financeira aparecerão aqui quando houver registros
            </p>
          </div>
        ) : temNotificacoesManuais ? (
          <>
            {/* Título de Ações Manuais (se houver notificações automáticas também) */}
            {temNotificacoesAutomaticas && (
              <div className="mb-4 pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Outras Ações</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Ações manuais realizadas no sistema
                </p>
              </div>
            )}
            
            <div className="space-y-8">
              {/* WhatsApp */}
            {logsAgrupados.whatsapp.length > 0 && (
              <div className="border-l-4 border-green-500 pl-4">
                {/* Header do canal com contador */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-slate-900">WhatsApp</span>
                  <span className="text-xs text-slate-500">
                    ({logsAgrupados.whatsapp.length}{' '}
                    {logsAgrupados.whatsapp.length === 1 ? 'envio' : 'envios'})
                  </span>
                </div>

                {/* Lista de notificações */}
                <div className="space-y-2">
                  {logsAgrupados.whatsapp.map((log) => (
                    <div
                      key={log.id}
                      className="bg-white rounded-lg border border-slate-200 p-3 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 mb-1">
                            {getTextoAmigavel(log.acao)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span>{formatDate(log.createdAt)}</span>
                            <span className="text-slate-400">•</span>
                            <span>{log.usuario?.nome || 'Sistema'}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                            <span className="text-xs font-medium text-green-700">Enviado</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email */}
            {logsAgrupados.email.length > 0 && (
              <div className="border-l-4 border-blue-500 pl-4">
                {/* Header do canal com contador */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-slate-900">E-mail</span>
                  <span className="text-xs text-slate-500">
                    ({logsAgrupados.email.length}{' '}
                    {logsAgrupados.email.length === 1 ? 'envio' : 'envios'})
                  </span>
                </div>

                {/* Lista de notificações */}
                <div className="space-y-2">
                  {logsAgrupados.email.map((log) => (
                    <div
                      key={log.id}
                      className="bg-white rounded-lg border border-slate-200 p-3 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 mb-1">
                            {getTextoAmigavel(log.acao)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span>{formatDate(log.createdAt)}</span>
                            <span className="text-slate-400">•</span>
                            <span>{log.usuario?.nome || 'Sistema'}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                            <span className="text-xs font-medium text-green-700">Enviado</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SMS */}
            {logsAgrupados.sms.length > 0 && (
              <div className="border-l-4 border-purple-500 pl-4">
                {/* Header do canal com contador */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-slate-900">SMS</span>
                  <span className="text-xs text-slate-500">
                    ({logsAgrupados.sms.length}{' '}
                    {logsAgrupados.sms.length === 1 ? 'envio' : 'envios'})
                  </span>
                </div>

                {/* Lista de notificações */}
                <div className="space-y-2">
                  {logsAgrupados.sms.map((log) => (
                    <div
                      key={log.id}
                      className="bg-white rounded-lg border border-slate-200 p-3 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 mb-1">
                            {getTextoAmigavel(log.acao)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span>{formatDate(log.createdAt)}</span>
                            <span className="text-slate-400">•</span>
                            <span>{log.usuario?.nome || 'Sistema'}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                            <span className="text-xs font-medium text-green-700">Enviado</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outros */}
            {logsAgrupados.outros.length > 0 && (
              <div className="border-l-4 border-slate-400 pl-4">
                {/* Header do canal com contador */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-slate-900">Outras ações</span>
                  <span className="text-xs text-slate-500">({logsAgrupados.outros.length})</span>
                </div>

                {/* Lista de notificações */}
                <div className="space-y-2">
                  {logsAgrupados.outros.map((log) => (
                    <div
                      key={log.id}
                      className="bg-white rounded-lg border border-slate-200 p-3 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 mb-1">
                            {getTextoAmigavel(log.acao)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span>{formatDate(log.createdAt)}</span>
                            <span className="text-slate-400">•</span>
                            <span>{log.usuario?.nome || 'Sistema'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

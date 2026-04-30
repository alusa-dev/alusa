/**
 * Componente de Timeline de Auditoria Financeira
 *
 * Exibe historico completo de eventos de uma cobrança de forma visual
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  ClockIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

// Helper para formatar moeda
const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

interface TimelineEvent {
  tipo: string;
  data: Date | string;
  descricao: string;
  usuario?: {
    nome: string;
    email: string;
    role: string;
  };
  detalhes?: Record<string, unknown>;
}

interface CobrancaAuditoriaProps {
  cobrancaId: string;
  timeline: TimelineEvent[];
  stats: {
    diasDesdeVencimento: number;
    totalPago: number;
    totalEstornado: number;
    saldoDevedor: number;
    totalWebhooks: number;
    totalLogs: number;
  };
}

const tipoIcons: Record<string, React.ElementType> = {
  CRIACAO: DocumentTextIcon,
  PAGAMENTO: CurrencyDollarIcon,
  CONFIRMACAO_PAGAMENTO: CheckCircleIcon,
  CANCELAMENTO: XCircleIcon,
  ESTORNO: ArrowPathIcon,
  ESTORNO_PARCIAL: ArrowPathIcon,
  ESTORNO_TOTAL: ArrowPathIcon,
  REENVIAR: ExclamationCircleIcon,
  SEGUNDA_VIA: DocumentTextIcon,
  CONFIRMAR_MANUAL: CheckCircleIcon,
  REATIVAR: CheckCircleIcon,
};

const tipoColors: Record<string, string> = {
  CRIACAO: 'text-blue-500',
  PAGAMENTO: 'text-green-500',
  CONFIRMACAO_PAGAMENTO: 'text-green-600',
  CANCELAMENTO: 'text-red-500',
  ESTORNO: 'text-orange-500',
  ESTORNO_PARCIAL: 'text-yellow-500',
  ESTORNO_TOTAL: 'text-orange-600',
  REENVIAR: 'text-blue-400',
  SEGUNDA_VIA: 'text-gray-500',
  CONFIRMAR_MANUAL: 'text-emerald-500',
  REATIVAR: 'text-teal-500',
};

export function CobrancaAuditoriaTimeline({ timeline, stats }: CobrancaAuditoriaProps) {
  return (
    <div className="space-y-6">
      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Dias desde vencimento</CardDescription>
            <CardTitle className="text-2xl">
              {stats.diasDesdeVencimento > 0 ? '+' : ''}
              {stats.diasDesdeVencimento}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total pago</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {formatCurrency(stats.totalPago)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total estornado</CardDescription>
            <CardTitle className="text-2xl text-orange-600">
              {formatCurrency(stats.totalEstornado)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Saldo devedor</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              {formatCurrency(stats.saldoDevedor)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Webhooks</CardDescription>
            <CardTitle className="text-2xl">{stats.totalWebhooks}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Logs</CardDescription>
            <CardTitle className="text-2xl">{stats.totalLogs}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Eventos</CardTitle>
          <CardDescription>
            Timeline completa de todas as operações realizadas nesta cobrança
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-4">
            {/* Linha vertical */}
            <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />

            {timeline.map((event, index) => {
              const Icon = tipoIcons[event.tipo] || ClockIcon;
              const colorClass = tipoColors[event.tipo] || 'text-gray-500';

              return (
                <div key={index} className="relative pl-14">
                  {/* Ícone */}
                  <div
                    className={`absolute left-3 -ml-3 flex h-6 w-6 items-center justify-center rounded-full bg-background border-2 ${colorClass}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Conteúdo */}
                  <div className="rounded-lg border p-4 bg-card">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{event.descricao}</h4>
                          <Badge variant="outline" className="text-xs">
                            {event.tipo}
                          </Badge>
                        </div>

                        <p className="text-sm text-muted-foreground">
                          {format(new Date(event.data), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", {
                            locale: ptBR,
                          })}
                        </p>

                        {event.usuario && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <UserIcon className="h-3 w-3" />
                            <span>
                              {event.usuario.nome} ({event.usuario.role})
                            </span>
                          </div>
                        )}

                        {event.detalhes && Object.keys(event.detalhes).length > 0 && (
                          <div className="mt-2 rounded bg-muted/50 p-2">
                            <pre className="text-xs overflow-x-auto">
                              {JSON.stringify(event.detalhes, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {timeline.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum evento registrado ainda
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

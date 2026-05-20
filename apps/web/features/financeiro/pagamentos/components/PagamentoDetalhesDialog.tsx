'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type StatusType } from '@/components/ui/badge';
import { pushToast } from '@/components/ui/toast';
import { ClipboardDocumentCheck as Receipt, Eye } from '@/components/icons/icons';

interface Pagamento {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  comprovante: string | null;
  cobrancaId: string;
  cobranca: {
    id: string;
    tipo: string;
    status: string;
    valor: number;
    vencimento: string;
    descricao: string | null;
  };
  asaasPaymentId: string | null;
  createdAt: string;
}

interface PagamentoDetalhesDialogProps {
  open: boolean;
  alunoId: string | null;
  alunoNome: string | null;
  onOpenChange: (open: boolean) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => {
  try {
    return new Intl.DateTimeFormat('pt-BR').format(new Date(dateStr));
  } catch {
    return '—';
  }
};

const getFormaPagamentoLabel = (forma: string) => {
  const labels: Record<string, string> = {
    PIX: 'PIX',
    BOLETO: 'Boleto',
    CARTAO: 'Cartão',
    DINHEIRO: 'Dinheiro',
    TRANSFERENCIA: 'Transferência',
  };
  return labels[forma] || forma;
};

const sanitizeMessage = (message: string) =>
  message
    .replace(/Asaas/gi, 'financeiro')
    .replace(/webhooks?/gi, 'atualizações automáticas')
    .replace(/assinatura/gi, 'cobrança recorrente')
    .trim();

export function PagamentoDetalhesDialog({
  open,
  alunoId,
  alunoNome,
  onOpenChange,
}: PagamentoDetalhesDialogProps) {
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedComprovante, setSelectedComprovante] = useState<string | null>(null);

  const loadPagamentos = useCallback(async () => {
    if (!alunoId || !open) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/financeiro/pagamentos/aluno/${alunoId}`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Falha ao carregar pagamentos');
      }

      const data = await res.json();
      setPagamentos(data.data || []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro desconhecido';
      setError(message);
      pushToast({
        title: 'Não foi possível carregar os pagamentos',
        description: sanitizeMessage(message) || 'Tente novamente em instantes.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [alunoId, open]);

  useEffect(() => {
    if (open && alunoId) {
      loadPagamentos();
    } else {
      setPagamentos([]);
      setError(null);
    }
  }, [open, alunoId, loadPagamentos]);

  const handleViewComprovante = (comprovante: string) => {
    // Se for URL, abre em nova aba
    if (comprovante.startsWith('http') || comprovante.startsWith('/')) {
      window.open(comprovante, '_blank', 'noopener,noreferrer');
    } else {
      setSelectedComprovante(comprovante);
    }
  };

  const totalPago = pagamentos.reduce((acc, pag) => acc + pag.valorPago, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div>
                <DialogTitle className="text-xl font-semibold text-gray-900">
                  Histórico de Pagamentos
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-600 mt-1">
                  {alunoNome}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-6">
            {loading && (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-6 w-32" />
                      <Skeleton className="h-6 w-24" />
                    </div>
                    <div className="mt-3 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-4 w-36" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="text-center py-12">
                <p className="text-red-600 text-sm">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadPagamentos}
                  className="mt-4"
                >
                  Tentar novamente
                </Button>
              </div>
            )}

            {!loading && !error && pagamentos.length === 0 && (
              <div className="text-center py-12">
                <Receipt className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-sm text-gray-600">
                  Nenhum pagamento encontrado para este aluno.
                </p>
              </div>
            )}

            {!loading && !error && pagamentos.length > 0 && (
              <>
                {/* Resumo */}
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-6 mb-6 border border-purple-100">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                        Total de Pagamentos
                      </p>
                      <p className="mt-2 text-2xl font-bold text-gray-900">
                        {pagamentos.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                        Valor Total Pago
                      </p>
                      <p className="mt-2 text-2xl font-bold text-purple-700">
                        {formatCurrency(totalPago)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                        Último Pagamento
                      </p>
                      <p className="mt-2 text-lg font-semibold text-gray-700">
                        {pagamentos[0]?.dataPagamento
                          ? formatDate(pagamentos[0].dataPagamento)
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Lista de Pagamentos */}
                <div className="space-y-3">
                  {pagamentos.map((pag) => (
                    <div
                      key={pag.id}
                      className="border rounded-lg p-5 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <Badge status={pag.status as StatusType} size="sm" />
                            <span className="text-sm font-medium text-gray-900">
                              {getFormaPagamentoLabel(pag.formaPagamento)}
                            </span>
                            <span className="text-xs text-gray-500">
                              • {pag.cobranca.tipo}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-500 font-medium">Valor Pago</p>
                              <p className="mt-1 font-semibold text-purple-700">
                                {formatCurrency(pag.valorPago)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 font-medium">Data Pagamento</p>
                              <p className="mt-1 text-gray-900">
                                {pag.dataPagamento ? formatDate(pag.dataPagamento) : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 font-medium">Vencimento Cobrança</p>
                              <p className="mt-1 text-gray-900">
                                {formatDate(pag.cobranca.vencimento)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 font-medium">Status Cobrança</p>
                              <p className="mt-1">
                                <Badge status={pag.cobranca.status as StatusType} size="sm" />
                              </p>
                            </div>
                          </div>

                          {pag.cobranca.descricao && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs text-gray-500 font-medium">Descrição</p>
                              <p className="mt-1 text-sm text-gray-700">
                                {pag.cobranca.descricao}
                              </p>
                            </div>
                          )}

                          {pag.asaasPaymentId && (
                            <div className="mt-3">
                              <p className="text-xs text-green-700 font-mono">
                                ID Asaas: {pag.asaasPaymentId}
                              </p>
                            </div>
                          )}
                        </div>

                        {pag.comprovante && (
                          <div className="ml-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewComprovante(pag.comprovante!)}
                              className="gap-2"
                            >
                              <Eye className="h-4 w-4" />
                              Ver Comprovante
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog para visualizar comprovante */}
      {selectedComprovante && (
        <Dialog open={!!selectedComprovante} onOpenChange={() => setSelectedComprovante(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Comprovante de Pagamento</DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              <img
                src={selectedComprovante}
                alt="Comprovante"
                className="w-full h-auto rounded-lg border"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

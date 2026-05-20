'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type StatusType } from '@/components/ui/badge';
import {
  XMarkIcon,
  QrCodeIcon,
  DocumentDuplicateIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import {
  resendCobrancaRequest,
  type ResendCobrancaData,
  type MatriculaCobrancaStatus,
  type MatriculaListItem,
} from '../services/matriculas-service';
import { pushToast } from '@/components/ui/toast';

// Formatadores locais
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface MatriculaDetalhesDialogProps {
  open: boolean;
  matricula: MatriculaListItem | null;
  onOpenChange: (_open: boolean) => void;
  onRefresh?: () => void;
}

export function MatriculaDetalhesDialog({
  open,
  matricula,
  onOpenChange,
  onRefresh,
}: MatriculaDetalhesDialogProps) {
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [taxaLinks, setTaxaLinks] = useState<ResendCobrancaData | null>(null);
  const [copyingPix, setCopyingPix] = useState(false);

  useEffect(() => {
    if (!open) {
      setTaxaLinks(null);
      setLoadingLinks(false);
      setCopyingPix(false);
    }
  }, [open]);

  useEffect(() => {
    setTaxaLinks(null);
  }, [matricula?.id]);

  const taxaCobranca = useMemo(() => {
    if (!matricula) return null;
    return matricula.cobrancas.find((c) => c.tipo === 'TAXA_MATRICULA') ?? null;
  }, [matricula]);

  const cobrancaStatus = taxaLinks?.status ?? taxaCobranca?.status ?? null;
  const previousStatus = taxaLinks?.previousStatus ?? null;

  const formatTaxaStatus = useCallback((status?: MatriculaCobrancaStatus | null) => {
    if (!status) return '—';
    return status
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }, []);

  const handleCopyPix = useCallback(async (pixValue: string) => {
    if (!pixValue) return;
    try {
      setCopyingPix(true);
      await navigator.clipboard.writeText(pixValue);
      pushToast({
        title: 'PIX copiado',
        description: 'Código copiado para a área de transferência.',
        variant: 'success',
      });
    } catch (error) {
      pushToast({
        title: 'Erro ao copiar PIX',
        description:
          (error as Error).message || 'Não foi possível copiar o código copia e cola no momento.',
        variant: 'error',
      });
    } finally {
      setCopyingPix(false);
    }
  }, []);

  const handleGerarSegundaVia = useCallback(async () => {
    if (!matricula || !taxaCobranca) {
      pushToast({
        title: 'Cobrança não encontrada',
        description: 'Não identificamos uma taxa de matrícula para reenviar.',
        variant: 'error',
      });
      return;
    }

    try {
      setLoadingLinks(true);
      const response = await resendCobrancaRequest(taxaCobranca.id);
      setTaxaLinks(response.data);

      pushToast({
        title: 'Segunda via gerada',
        description: 'Os dados da cobrança foram atualizados e o novo link já está disponível.',
        variant: 'success',
      });

      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      pushToast({
        title: 'Erro ao reenviar cobrança',
        description: (error as Error).message || 'Não foi possível atualizar a cobrança agora. Tente novamente em instantes.',
        variant: 'error',
      });
    } finally {
      setLoadingLinks(false);
    }
  }, [matricula, onRefresh, taxaCobranca]);

  const handleAbrirComprovante = useCallback(async () => {
    if (!taxaCobranca) return;
    try {
      const res = await fetch(`/api/cobrancas/${taxaCobranca.id}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { asaasData?: { transactionReceiptUrl?: string; invoiceUrl?: string } };
      };
      const url = json?.data?.asaasData?.transactionReceiptUrl || json?.data?.asaasData?.invoiceUrl;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch (_err) {
      // ignore
    }
    window.open(`/cobrancas/${taxaCobranca.id}`, '_blank', 'noopener,noreferrer');
  }, [taxaCobranca]);

  const cobrancasList = useMemo(() => {
    if (!matricula) return [];
    if (!taxaLinks) return matricula.cobrancas;
    return matricula.cobrancas.map((cobranca) =>
      cobranca.id === taxaLinks.cobrancaId ? { ...cobranca, status: taxaLinks.status } : cobranca,
    );
  }, [matricula, taxaLinks]);

  const isTaxaPaga = taxaCobranca?.status === 'PAGO';

  if (!matricula) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 rounded-2xl overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b bg-white sticky top-0 z-10">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-xl font-semibold text-gray-900">
                Detalhes da Matrícula
              </DialogTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <XMarkIcon className="h-5 w-5" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {/* Seção: Aluno */}
            <div className="border-b pb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Dados do Aluno
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Nome Completo</label>
                    <Input
                      value={matricula.aluno.nome || ''}
                      readOnly
                      disabled
                      className="bg-gray-100 border border-gray-200 text-gray-500 shadow-none text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">CPF</label>
                    <Input
                      value={matricula.aluno.cpf
                        ? matricula.aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
                        : ''}
                      readOnly
                      disabled
                      className="bg-gray-100 border border-gray-200 text-gray-500 shadow-none text-sm mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Seção: Matrícula */}
            <div className="border-b pb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Informações da Matrícula
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Status</label>
                    <div className="mt-1">
                      <Badge status={matricula.status as StatusType} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Dia de Vencimento</label>
                    <p className="text-sm text-gray-900 mt-1">Dia {matricula.vencimentoDia}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Data de Início</label>
                    <p className="text-sm text-gray-900 mt-1">
                      {dateFormat.format(new Date(matricula.dataInicio))}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Seção: Turma/Combo */}
            <div className="border-b pb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Turma/Combo
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                {matricula.turma && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Turma</label>
                      <p className="text-sm text-gray-900 mt-1">{matricula.turma.nome}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Horário</label>
                        <p className="text-sm text-gray-900 mt-1">
                          {matricula.turma.horaInicio} - {matricula.turma.horaFim}
                        </p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Dias da Semana</label>
                        <p className="text-sm text-gray-900 mt-1">
                          {matricula.turma.diasSemana.join(', ') || '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {matricula.combo && (
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Combo</label>
                    <p className="text-sm text-gray-900 mt-1">{matricula.combo.nome}</p>
                  </div>
                )}
                {!matricula.turma && !matricula.combo && <p className="text-sm text-gray-500">—</p>}
              </div>
            </div>

            {/* Seção: Plano */}
            {matricula.plano ? (
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Plano
                </h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Nome do Plano</label>
                      <p className="text-sm text-gray-900 mt-1">{matricula.plano.nome}</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Valor</label>
                      <p className="text-sm font-semibold text-brand-accent mt-1">
                        {currency.format(matricula.plano.valor)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : matricula.combo ? (
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Combo
                </h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-900">{matricula.combo.nome}</p>
                </div>
              </div>
            ) : null}

            {/* Seção: Taxa de Matrícula */}
            <div className="border-b pb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Taxa de Matrícula
              </h3>

              <div className="rounded-xl border-2 bg-gradient-to-br from-gray-50 to-white p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 font-medium block mb-1.5">Valor da Taxa</label>
                    <p className="text-lg font-bold text-gray-900">
                      {currency.format(matricula.taxaMatricula)}
                    </p>
                  </div>
                  {!isTaxaPaga && (
                    <div>
                      <label className="text-xs text-gray-500 font-medium block mb-1.5">Status da Taxa</label>
                      {matricula.taxaIsenta ? (
                        <Badge status="ISENTO" />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge status="PENDING">
                            <span className="flex items-center gap-1.5 px-2 py-0.5">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Pendente
                            </span>
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!matricula.taxaIsenta && taxaCobranca && (
                  <>
                    <div className="pt-4 border-t border-gray-200">
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        {taxaCobranca.vencimento && (
                          <div>
                            <label className="text-xs text-gray-500 font-medium block mb-1">Vencimento</label>
                            <p className="text-sm text-gray-900 font-semibold">
                              {dateFormat.format(new Date(taxaCobranca.vencimento))}
                            </p>
                          </div>
                        )}
                        {taxaCobranca.formaPagamento && (
                          <div>
                            <label className="text-xs text-gray-500 font-medium block mb-1">Forma de Pagamento</label>
                            <p className="text-sm text-gray-900 font-semibold">
                              {taxaCobranca.formaPagamento}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="mb-3">
                        <label className="text-xs text-gray-500 font-medium block mb-2">Status do Pagamento</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge status={cobrancaStatus as StatusType} size="sm" />
                          {previousStatus && taxaLinks?.status && previousStatus !== taxaLinks.status && (
                            <Badge variant="outline" className="text-[11px] uppercase tracking-wide">
                              Era {formatTaxaStatus(previousStatus)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      {isTaxaPaga ? (
                        <div className="flex justify-end">
                          <Button
                            onClick={handleAbrirComprovante}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white shadow-none"
                          >
                            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
                            Ver Comprovante
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <svg className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="text-sm text-amber-800">
                              <strong>Aguardando pagamento</strong>
                              <p className="mt-1 text-xs">A cobrança foi gerada. Você pode gerar uma segunda via ou reenviar os links de pagamento.</p>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              onClick={handleGerarSegundaVia}
                              disabled={loadingLinks}
                              size="sm"
                              className="flex-1 bg-brand-primary hover:bg-brand-primary/90 text-white shadow-none"
                            >
                              <QrCodeIcon className="h-4 w-4 mr-2" />
                              {loadingLinks ? 'Gerando...' : 'Gerar Segunda Via'}
                            </Button>
                            <Button
                              onClick={() => window.open(`/cobrancas/${taxaCobranca.id}`, '_blank', 'noopener,noreferrer')}
                              size="sm"
                              variant="outline"
                              className="flex-1 shadow-none border-gray-300"
                            >
                              <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
                              Ver Detalhes
                            </Button>
                          </div>

                          {taxaLinks && (
                            <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50 p-4 space-y-3">
                              <div className="flex items-start gap-2">
                                <svg className="h-5 w-5 text-indigo-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-sm font-semibold text-indigo-900">
                                  Links atualizados! Envie ao responsável financeiro:
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {taxaLinks.invoiceUrl && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(taxaLinks.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                                    className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                                  >
                                    <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
                                    Checkout
                                  </Button>
                                )}
                                {taxaLinks.bankSlipUrl && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(taxaLinks.bankSlipUrl!, '_blank', 'noopener,noreferrer')}
                                    className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                                  >
                                    <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
                                    Boleto
                                  </Button>
                                )}
                                {taxaLinks.pixQrCodeUrl && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(taxaLinks.pixQrCodeUrl!, '_blank', 'noopener,noreferrer')}
                                    className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                                  >
                                    <QrCodeIcon className="h-4 w-4 mr-2" />
                                    QR Code PIX
                                  </Button>
                                )}
                              </div>
                              {taxaLinks.pixCopyPaste && (
                                <div className="space-y-2">
                                  <label className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                                    PIX copia e cola
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      value={taxaLinks.pixCopyPaste}
                                      readOnly
                                      className="text-xs font-mono bg-white border-indigo-300"
                                    />
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => handleCopyPix(taxaLinks.pixCopyPaste!)}
                                      disabled={copyingPix}
                                      className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                                    >
                                      <DocumentDuplicateIcon className="h-4 w-4 mr-2" />
                                      {copyingPix ? 'Copiando...' : 'Copiar'}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Seção: Responsável Financeiro */}
            {matricula.responsavelFinanceiro && (
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Responsável Financeiro
                </h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Nome Completo</label>
                      <Input
                        value={matricula.responsavelFinanceiro.nome || ''}
                        readOnly
                        disabled
                        className="bg-gray-100 border border-gray-200 text-gray-500 shadow-none text-sm mt-1"
                      />
                    </div>
                    {matricula.responsavelFinanceiro.email && (
                      <div>
                        <label className="text-xs text-gray-500 font-medium">E-mail</label>
                        <Input
                          value={matricula.responsavelFinanceiro.email}
                          readOnly
                          disabled
                          className="bg-gray-100 border border-gray-200 text-gray-500 shadow-none text-sm mt-1"
                        />
                      </div>
                    )}
                    {matricula.responsavelFinanceiro.telefone && (
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Telefone</label>
                        <Input
                          value={matricula.responsavelFinanceiro.telefone}
                          readOnly
                          disabled
                          className="bg-gray-100 border border-gray-200 text-gray-500 shadow-none text-sm mt-1"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Seção: Cobranças */}
            {cobrancasList.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Cobranças ({cobrancasList.length})
                </h3>
                <div className="space-y-2">
                  {cobrancasList.map((cobranca) => (
                    <div
                      key={cobranca.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {cobranca.tipo === 'TAXA_MATRICULA'
                            ? 'Taxa de Matrícula'
                            : cobranca.tipo === 'MENSALIDADE'
                              ? 'Mensalidade'
                              : 'Extra'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Vencimento: {dateFormat.format(new Date(cobranca.vencimento))} •{' '}
                          {cobranca.formaPagamento}
                        </p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-sm font-semibold text-gray-900">
                          {currency.format(cobranca.valor)}
                        </p>
                        <Badge status={cobranca.status as StatusType} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

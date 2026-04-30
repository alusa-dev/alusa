'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import type { StoreSaleChargeDTO, StoreSaleDTO } from '@alusa/finance';

import {
  CheckCircle,
  ChevronDown,
  Download,
  DocumentText,
  ExternalLink,
  Loader2,
  Receipt,
  ShoppingBag,
  WalletCards,
} from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';

import {
  BILLING_TYPE_LABELS,
  CHARGE_STATUS_LABELS,
  formatCurrencyBRL,
  formatDateBR,
  formatSaleNumber,
  getSale,
  INVENTORY_STATUS_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
} from './services/sales-service';

type CompletionMode = 'receipt' | 'charge';

interface SaleCompletionFeatureProps {
  saleId: string;
  mode: CompletionMode;
}

const RECEIPT_EXPORT_WIDTH_PX = 360;
const ASAAS_SEAL_URL = '/api/assets/asaas-seal?variant=negativo-preto';

function formatBillingType(value: string | null | undefined) {
  if (!value) return 'Forma não informada';
  return BILLING_TYPE_LABELS[value as keyof typeof BILLING_TYPE_LABELS] ?? value;
}

function formatChargeStatus(value: string | null | undefined) {
  if (!value) return 'Status não informado';
  return CHARGE_STATUS_LABELS[value] ?? value;
}

function formatDateTimeBR(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDocument(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');

  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  return value;
}

function formatPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');

  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }

  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }

  return value;
}

function getDisplayCharges(sale: StoreSaleDTO): StoreSaleChargeDTO[] {
  if (sale.installmentPlan?.charges.length) {
    return sale.installmentPlan.charges;
  }

  return sale.charge ? [sale.charge] : [];
}

function getPaymentLabel(sale: StoreSaleDTO): string {
  if (sale.paymentMethod) return SALE_PAYMENT_METHOD_LABELS[sale.paymentMethod];
  if (sale.installmentPlan) {
    return `${formatBillingType(sale.installmentPlan.billingType)} - ${sale.installmentPlan.installmentCount}x`;
  }
  if (sale.charge) return formatBillingType(sale.charge.billingType);
  return 'Não informado';
}

function sanitizeFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function ReceiptLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span
        className={strong ? 'text-right font-semibold text-slate-950' : 'text-right text-slate-800'}
      >
        {value}
      </span>
    </div>
  );
}

function AlusaReceiptLogo() {
  return (
    <div
      aria-label="Alusa"
      className="mb-6 flex h-12 w-full items-center justify-center overflow-visible text-center text-[42px] font-black leading-none tracking-normal text-slate-950"
      role="img"
    >
      alusa
    </div>
  );
}

export function SaleCompletionFeature({ saleId, mode }: SaleCompletionFeatureProps) {
  const [sale, setSale] = useState<StoreSaleDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState<'pdf' | 'image' | null>(null);
  const [asaasSealSrc, setAsaasSealSrc] = useState<string | null>(null);
  const receiptRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;

    setLoading(true);
    void getSale(saleId)
      .then((data) => {
        if (!alive) return;
        setSale(data);
        setError(null);
      })
      .catch((loadError: Error) => {
        if (!alive) return;
        setError(loadError.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [saleId]);

  useEffect(() => {
    let alive = true;

    void fetch(ASAAS_SEAL_URL)
      .then((response) => {
        if (!response.ok) throw new Error('Selo Asaas indisponível.');
        return response.text();
      })
      .then((svg) => {
        if (alive) setAsaasSealSrc(svgToDataUrl(svg));
      })
      .catch(() => {
        if (alive) setAsaasSealSrc(null);
      });

    return () => {
      alive = false;
    };
  }, []);

  const charges = useMemo(() => (sale ? getDisplayCharges(sale) : []), [sale]);
  const firstChargeLink = charges.find((charge) => charge.invoiceUrl)?.invoiceUrl ?? null;

  async function copyChargeLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link da cobrança copiado.');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }

  async function waitForReceiptImages(element: HTMLElement) {
    const images = Array.from(element.querySelectorAll('img'));
    await Promise.all(
      images.map((image) => {
        if (image.complete) return Promise.resolve();

        return image.decode().catch(() => undefined);
      }),
    );
  }

  async function renderReceiptCanvas() {
    const element = receiptRef.current;
    if (!element) throw new Error('Comprovante não encontrado.');

    const { default: html2canvas } = await import('html2canvas');
    const clone = element.cloneNode(true) as HTMLElement;
    const exportHeight = () => Math.ceil(clone.scrollHeight);

    clone.style.position = 'absolute';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.width = `${RECEIPT_EXPORT_WIDTH_PX}px`;
    clone.style.minWidth = `${RECEIPT_EXPORT_WIDTH_PX}px`;
    clone.style.maxWidth = `${RECEIPT_EXPORT_WIDTH_PX}px`;
    clone.style.height = 'auto';
    clone.style.maxHeight = 'none';
    clone.style.margin = '0';
    clone.style.boxSizing = 'border-box';
    clone.style.transform = 'none';
    clone.style.background = '#ffffff';

    document.body.appendChild(clone);

    try {
      await waitForReceiptImages(clone);
      await document.fonts?.ready.catch(() => undefined);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const height = exportHeight();

      return await html2canvas(clone, {
        allowTaint: false,
        backgroundColor: '#ffffff',
        height,
        imageTimeout: 15000,
        logging: false,
        scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
        scrollX: 0,
        scrollY: 0,
        useCORS: false,
        width: RECEIPT_EXPORT_WIDTH_PX,
        windowHeight: height,
        windowWidth: RECEIPT_EXPORT_WIDTH_PX,
      });
    } finally {
      clone.remove();
    }
  }

  async function downloadReceipt(format: 'pdf' | 'image') {
    if (!sale) return;

    setDownloadingReceipt(format);
    try {
      const canvas = await renderReceiptCanvas();
      const fileBase = sanitizeFileName(`comprovante-${formatSaleNumber(sale.saleNumber)}`);

      if (format === 'image') {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${fileBase}.png`;
        link.click();
        return;
      }

      const { default: jsPDF } = await import('jspdf');
      const imageData = canvas.toDataURL('image/png');
      const widthMm = 80;
      const heightMm = Math.max(120, (canvas.height * widthMm) / canvas.width);
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [widthMm, heightMm],
        compress: true,
      });

      doc.addImage(imageData, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');
      doc.save(`${fileBase}.pdf`);
    } catch (downloadError) {
      toast.error({
        title: 'Falha ao baixar comprovante',
        description: (downloadError as Error).message,
      });
    } finally {
      setDownloadingReceipt(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-slate-600">{error ?? 'Venda não encontrada.'}</p>
            <Button asChild variant="outline">
              <Link href="/vendas/historico">Voltar ao histórico</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isReceipt = mode === 'receipt';

  if (isReceipt) {
    const customerDocument = formatDocument(sale.customer.document);
    const merchantDocument = formatDocument(sale.merchant.document);
    const merchantPhone = formatPhone(sale.merchant.phone);

    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 md:px-6">
        <style jsx global>{`
          @media print {
            @page {
              size: 80mm 360mm;
              margin: 0;
            }

            html,
            body {
              width: 80mm !important;
              min-width: 80mm !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
            }

            body * {
              visibility: hidden !important;
            }

            .receipt-print-area,
            .receipt-print-area * {
              visibility: visible !important;
            }

            .receipt-print-area {
              position: fixed !important;
              inset: 0 !important;
              display: flex !important;
              justify-content: center !important;
              align-items: flex-start !important;
              width: 80mm !important;
              max-width: none !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              box-shadow: none !important;
            }

            .receipt-paper {
              width: 80mm !important;
              max-width: 80mm !important;
              min-height: 0 !important;
              margin: 0 !important;
              padding: 7mm 6mm !important;
              border: 0 !important;
              border-radius: 0 !important;
              box-shadow: none !important;
              print-color-adjust: exact !important;
              -webkit-print-color-adjust: exact !important;
            }

            .receipt-screen-only {
              display: none !important;
            }
          }
        `}</style>

        <div className="receipt-screen-only mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Receipt className="h-4 w-4" />
              Loja
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                Comprovante da compra
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {formatSaleNumber(sale.saleNumber)} · {sale.customer.displayName} ·{' '}
                {formatDateBR(sale.createdAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/vendas/nova">
                <ShoppingBag className="mr-2 h-4 w-4" />
                Nova venda
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/vendas/historico">Histórico</Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" disabled={downloadingReceipt !== null}>
                  <Download className="mr-2 h-4 w-4" />
                  {downloadingReceipt ? 'Preparando...' : 'Baixar comprovante'}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={downloadingReceipt !== null}
                  onClick={() => void downloadReceipt('pdf')}
                >
                  <DocumentText className="mr-2 h-4 w-4" />
                  Em PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={downloadingReceipt !== null}
                  onClick={() => void downloadReceipt('image')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Em imagem
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="receipt-print-area flex justify-center">
          <article
            ref={receiptRef}
            className="receipt-paper relative mx-auto w-[360px] max-w-full rounded-[22px] border border-slate-200 bg-white px-6 py-7 shadow-sm"
          >
            <div className="absolute -left-2 top-[132px] h-4 w-4 rounded-full bg-slate-50 print:hidden" />
            <div className="absolute -right-2 top-[132px] h-4 w-4 rounded-full bg-slate-50 print:hidden" />

            <header className="text-center">
              <AlusaReceiptLogo />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Comprovante de venda
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">
                {formatSaleNumber(sale.saleNumber)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Emitido em {formatDateTimeBR(sale.createdAt)}
              </p>
            </header>

            <div className="my-5 border-t border-dashed border-slate-200" />

            <section className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Dados da Escola
              </p>
              <ReceiptLine label="Nome" value={sale.merchant.name} strong />
              <ReceiptLine label="CPF/CNPJ" value={merchantDocument ?? 'Não informado'} />
              <ReceiptLine label="Telefone" value={merchantPhone ?? 'Não informado'} />
              <ReceiptLine label="Email" value={sale.merchant.email ?? 'Não informado'} />
            </section>

            <div className="my-5 border-t border-dashed border-slate-200" />

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Cliente
              </p>
              <ReceiptLine label="Nome" value={sale.customer.displayName} strong />
              <ReceiptLine label="CPF" value={customerDocument ?? 'Não informado'} />
              {sale.customer.alunoName && sale.customer.alunoName !== sale.customer.displayName ? (
                <ReceiptLine label="Aluno" value={sale.customer.alunoName} />
              ) : null}
              {sale.customer.responsavelName ? (
                <ReceiptLine label="Responsável" value={sale.customer.responsavelName} />
              ) : null}
              {sale.customer.phone ? (
                <ReceiptLine label="Telefone" value={sale.customer.phone} />
              ) : null}
              {sale.customer.email ? (
                <ReceiptLine label="E-mail" value={sale.customer.email} />
              ) : null}
            </section>

            <div className="my-5 border-t border-dashed border-slate-200" />

            <section>
              <div className="mb-3 grid grid-cols-[1fr,48px,82px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <span>Item</span>
                <span className="text-right">Qtd.</span>
                <span className="text-right">Total</span>
              </div>
              <div className="space-y-3">
                {sale.items.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr,48px,82px] gap-2 text-[13px]">
                    <div>
                      <p className="font-medium text-slate-950">{item.productName}</p>
                      <p className="text-xs text-slate-500">
                        {formatCurrencyBRL(item.unitPrice)} un.
                      </p>
                    </div>
                    <span className="text-right text-slate-700">{item.quantity}</span>
                    <span className="text-right font-semibold text-slate-950">
                      {formatCurrencyBRL(item.subtotal)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-5 border-t border-dashed border-slate-200" />

            <section className="space-y-2">
              <ReceiptLine label="Subtotal" value={formatCurrencyBRL(sale.subtotal)} />
              <ReceiptLine label="Desconto" value={formatCurrencyBRL(sale.discount)} />
              <div className="pt-2">
                <ReceiptLine label="Total" value={formatCurrencyBRL(sale.total)} strong />
              </div>
            </section>

            <div className="my-5 border-t border-dashed border-slate-200" />

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Pagamento
              </p>
              <ReceiptLine
                label="Status"
                value={sale.status === 'CONCLUIDA' ? 'Concluída' : 'Pendente'}
                strong
              />
              <ReceiptLine label="Forma" value={getPaymentLabel(sale)} />
              <ReceiptLine label="Estoque" value={INVENTORY_STATUS_LABELS[sale.inventoryStatus]} />
              <ReceiptLine label="Operador" value={sale.operator.name} />
              {sale.amountReceived != null ? (
                <ReceiptLine label="Recebido" value={formatCurrencyBRL(sale.amountReceived)} />
              ) : null}
              {sale.changeGiven != null && sale.changeGiven > 0 ? (
                <ReceiptLine label="Troco" value={formatCurrencyBRL(sale.changeGiven)} />
              ) : null}
            </section>

            <div className="my-5 border-t border-dashed border-slate-200" />

            <footer className="space-y-4 text-center">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Documento sem valor fiscal. Guarde este comprovante para conferência da compra.
              </p>
              <div className="flex justify-center">
                {asaasSealSrc ? (
                  <img
                    src={asaasSealSrc}
                    alt="Serviços financeiros Asaas"
                    className="h-10 w-auto"
                  />
                ) : (
                  <span className="text-xs font-medium text-slate-900">
                    Serviços financeiros Asaas
                  </span>
                )}
              </div>
            </footer>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-12 pt-6 md:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <WalletCards className="h-4 w-4" />
            Loja
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Cobrança gerada
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {formatSaleNumber(sale.saleNumber)} · {sale.customer.displayName} ·{' '}
              {formatDateBR(sale.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/vendas/nova">
              <ShoppingBag className="mr-2 h-4 w-4" />
              Nova venda
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/vendas/historico">Histórico</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Itens</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-slate-100 p-0">
              {sale.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div>
                    <p className="font-medium text-slate-900">{item.productName}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.quantity} un. · {formatCurrencyBRL(item.unitPrice)}
                    </p>
                  </div>
                  <p className="font-semibold text-slate-900">{formatCurrencyBRL(item.subtotal)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {sale.installmentPlan ? 'Parcelas da cobrança' : 'Detalhes da cobrança'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {charges.length > 0 ? (
                charges.map((charge, index) => (
                  <div
                    key={charge.id}
                    className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr,140px,140px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {sale.installmentPlan
                          ? `Parcela ${index + 1}/${sale.installmentPlan.installmentCount}`
                          : 'Cobrança'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatBillingType(charge.billingType)} · Vencimento{' '}
                        {formatDateBR(charge.dueDate)}
                      </p>
                    </div>
                    <div className="text-sm">
                      <span className="text-slate-500">Status</span>
                      <p className="font-medium text-slate-900">
                        {formatChargeStatus(charge.status)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 md:justify-end">
                      <span className="text-sm font-semibold text-slate-900">
                        {formatCurrencyBRL(charge.value ?? 0)}
                      </span>
                      {charge.invoiceUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={charge.invoiceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Cobrança criada, aguardando sincronização do serviço financeiro.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                Resumo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status</span>
                <Badge variant={sale.status === 'CONCLUIDA' ? 'success' : 'warning'}>
                  {sale.status === 'CONCLUIDA' ? 'Concluída' : 'Pendente'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Estoque</span>
                <span className="font-medium text-slate-900">
                  {INVENTORY_STATUS_LABELS[sale.inventoryStatus]}
                </span>
              </div>
              {sale.installmentPlan ? (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Parcelamento</span>
                  <span className="font-medium text-slate-900">
                    {sale.installmentPlan.installmentCount}x
                  </span>
                </div>
              ) : null}
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{formatCurrencyBRL(sale.subtotal)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-slate-600">
                  <span>Desconto</span>
                  <span>{formatCurrencyBRL(sale.discount)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-base font-semibold text-slate-900">
                  <span>Total</span>
                  <span>{formatCurrencyBRL(sale.total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {firstChargeLink ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Link de pagamento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild className="w-full">
                  <a href={firstChargeLink} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir cobrança
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void copyChargeLink(firstChargeLink)}
                >
                  Copiar link
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

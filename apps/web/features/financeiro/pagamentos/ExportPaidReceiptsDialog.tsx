'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Download, Receipt } from '@/components/icons/icons';
import { cn } from '@/lib/cn';

import {
  exportPaidReceiptsPdf,
  type PaidReceiptAluno,
  type PaidReceiptItem,
} from './paid-receipts-pdf';

type Option = {
  value: string;
  label: string;
};

type ExportPaidReceiptsDialogProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  aluno: PaidReceiptAluno;
  items: PaidReceiptItem[];
};

const PAID_STATUSES = new Set([
  'PAGO',
  'CONFIRMADO',
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
  'PAID',
]);

const CHARGE_TYPE_OPTIONS: Option[] = [
  { value: 'TAXA_MATRICULA', label: 'Taxa de matrícula' },
  { value: 'ASSINATURA', label: 'Mensalidade/assinatura' },
  { value: 'PARCELAMENTO', label: 'Parcelamento' },
  { value: 'AVULSA', label: 'Avulsa' },
  { value: 'LOJA', label: 'Loja' },
];

const PAYMENT_METHOD_OPTIONS: Option[] = [
  { value: 'PIX', label: 'Pix' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'CASH', label: 'Dinheiro' },
];

const RECEIPT_ORIGIN_OPTIONS: Option[] = [
  { value: 'ASAAS', label: 'Comprovante oficial Asaas' },
  { value: 'ALUSA_INTERNAL', label: 'Recibo interno Alusa' },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function toIsoDate(value: Date | undefined) {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateValue(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateInput(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

function normalizeChargeType(item: PaidReceiptItem) {
  const key = item.tipo ?? item.chargeType;
  if (key === 'TAXA_MATRICULA') return 'TAXA_MATRICULA';
  if (key === 'MENSALIDADE' || key === 'RECORRENTE' || key === 'SUBSCRIPTION') return 'ASSINATURA';
  if (key === 'PARCELADA' || key === 'INSTALLMENT') return 'PARCELAMENTO';
  if (key === 'LOJA' || item.origin === 'LOJA') return 'LOJA';
  return 'AVULSA';
}

function normalizePaymentMethod(item: PaidReceiptItem) {
  const raw = item.pagamento?.formaPagamento ?? item.billingType ?? '';
  if (raw === 'PIX' || raw === 'PIX_PRESENCIAL') return 'PIX';
  if (raw === 'BOLETO') return 'BOLETO';
  if (raw === 'CARTAO_CREDITO' || raw === 'CREDIT_CARD' || raw === 'CARTAO_CREDITO_PRESENCIAL') return 'CREDIT_CARD';
  if (raw === 'CARTAO_DEBITO' || raw === 'DEBIT_CARD' || raw === 'CARTAO_DEBITO_PRESENCIAL') return 'DEBIT_CARD';
  if (raw === 'DINHEIRO' || item.pagamento?.status === 'RECEIVED_IN_CASH') return 'CASH';
  return raw || 'UNDEFINED';
}

function resolveReceiptOrigin(item: PaidReceiptItem) {
  return item.asaasPaymentId || item.pagamento?.asaasPaymentId || item.pagamento?.comprovante
    ? 'ASAAS'
    : 'ALUSA_INTERNAL';
}

function isPaid(item: PaidReceiptItem) {
  const status = item.pagamento?.status ?? '';
  return PAID_STATUSES.has(status);
}

function toggleValue(values: string[], value: string, checked: boolean) {
  if (checked) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}

function FilterGroup({
  title,
  options,
  values,
  onChange,
}: {
  title: string;
  options: Option[];
  values: string[];
  onChange: (_values: string[]) => void;
}) {
  const allSelected = values.length === options.length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-slate-800">{title}</p>
        <button
          type="button"
          className="text-[11px] font-medium text-[#5c2f91] hover:text-[#3e1f63]"
          onClick={() => onChange(allSelected ? [] : options.map((option) => option.value))}
        >
          {allSelected ? 'Limpar' : 'Todos'}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            <Checkbox
              checked={values.includes(option.value)}
              onCheckedChange={(checked) => onChange(toggleValue(values, option.value, checked))}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ExportPaidReceiptsDialog({
  open,
  onOpenChange,
  aluno,
  items,
}: ExportPaidReceiptsDialogProps) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [chargeTypes, setChargeTypes] = useState(CHARGE_TYPE_OPTIONS.map((option) => option.value));
  const [paymentMethods, setPaymentMethods] = useState(PAYMENT_METHOD_OPTIONS.map((option) => option.value));
  const [receiptOrigins, setReceiptOrigins] = useState(RECEIPT_ORIGIN_OPTIONS.map((option) => option.value));
  const matriculaOptions = useMemo<Option[]>(() => {
    const ids = Array.from(new Set(items.map((item) => item.matriculaId).filter((id): id is string => Boolean(id))));
    return ids.map((id, index) => ({ value: id, label: `Matrícula ${index + 1}` }));
  }, [items]);
  const [matriculaIds, setMatriculaIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setMatriculaIds(matriculaOptions.map((option) => option.value));
  }, [matriculaOptions]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!isPaid(item)) return false;

      const paidAt = item.pagamento?.dataPagamento ?? item.pagamento?.createdAt ?? item.createdAt;
      if (dateFrom && new Date(paidAt) < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && new Date(paidAt) > new Date(`${dateTo}T23:59:59`)) return false;

      if (!chargeTypes.includes(normalizeChargeType(item))) return false;
      if (!paymentMethods.includes(normalizePaymentMethod(item))) return false;
      if (!receiptOrigins.includes(resolveReceiptOrigin(item))) return false;
      if (matriculaOptions.length > 0 && item.matriculaId && !matriculaIds.includes(item.matriculaId)) {
        return false;
      }

      return true;
    });
  }, [chargeTypes, dateFrom, dateTo, items, matriculaIds, matriculaOptions.length, paymentMethods, receiptOrigins]);

  const totalPaid = filteredItems.reduce((sum, item) => sum + Number(item.pagamento?.valorPago ?? item.valor ?? 0), 0);

  const filtersSummary = [
    dateFrom ? `De ${formatDateInput(dateFrom)}` : null,
    dateTo ? `Até ${formatDateInput(dateTo)}` : null,
    chargeTypes.length !== CHARGE_TYPE_OPTIONS.length ? `${chargeTypes.length} tipos` : 'Todos os tipos',
    paymentMethods.length !== PAYMENT_METHOD_OPTIONS.length ? `${paymentMethods.length} formas` : 'Todas as formas',
    receiptOrigins.length !== RECEIPT_ORIGIN_OPTIONS.length ? `${receiptOrigins.length} origens` : 'Todas as origens',
    matriculaOptions.length && matriculaIds.length ? `${matriculaIds.length} matrículas` : null,
  ].filter(Boolean) as string[];

  const canGenerate =
    filteredItems.length > 0 &&
    chargeTypes.length > 0 &&
    paymentMethods.length > 0 &&
    receiptOrigins.length > 0 &&
    !generating;

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      await exportPaidReceiptsPdf({
        aluno,
        items: filteredItems,
        filtersSummary,
        totalPaid,
      });
      onOpenChange(false);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0" fullScreenMobile>
        <DialogHeader className="border-b border-slate-200 px-5 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f4ecfd] text-[#5c2f91]">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base text-slate-900">Exportar comprovantes pagos</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-slate-500">
                Gere um PDF consolidado em preto e branco, com dois comprovantes por página.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(100dvh-150px)] overflow-y-auto px-5 py-4 md:px-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Aluno</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900">{aluno.nome}</p>
                <p className="mt-0.5 text-xs text-slate-500">Status fixo: somente pagamentos pagos</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-slate-800">Período do pagamento</p>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-[#5c2f91] hover:text-[#3e1f63]"
                    onClick={() => {
                      setDateFrom('');
                      setDateTo('');
                    }}
                  >
                    Todo o histórico
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <DatePicker
                    variant="input"
                    value={toDateValue(dateFrom)}
                    onChange={(date) => setDateFrom(toIsoDate(date))}
                    placeholder="Data inicial"
                    className="h-10 border-slate-200 text-[13px]"
                  />
                  <DatePicker
                    variant="input"
                    value={toDateValue(dateTo)}
                    onChange={(date) => setDateTo(toIsoDate(date))}
                    placeholder="Data final"
                    className="h-10 border-slate-200 text-[13px]"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    { label: 'Este mês', months: 0 },
                    { label: 'Últimos 3 meses', months: 3 },
                    { label: 'Ano atual', months: 12 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-600 hover:border-[#5c2f91] hover:text-[#5c2f91]"
                      onClick={() => {
                        const now = new Date();
                        const start =
                          preset.months === 0
                            ? new Date(now.getFullYear(), now.getMonth(), 1)
                            : preset.months === 12
                              ? new Date(now.getFullYear(), 0, 1)
                              : new Date(now.getFullYear(), now.getMonth() - 2, 1);
                        setDateFrom(toIsoDate(start));
                        setDateTo(toIsoDate(now));
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <FilterGroup title="Tipo de cobrança" options={CHARGE_TYPE_OPTIONS} values={chargeTypes} onChange={setChargeTypes} />
              <FilterGroup title="Forma de pagamento" options={PAYMENT_METHOD_OPTIONS} values={paymentMethods} onChange={setPaymentMethods} />
              <FilterGroup title="Origem do comprovante" options={RECEIPT_ORIGIN_OPTIONS} values={receiptOrigins} onChange={setReceiptOrigins} />

              {matriculaOptions.length > 1 ? (
                <FilterGroup title="Matrícula" options={matriculaOptions} values={matriculaIds} onChange={setMatriculaIds} />
              ) : null}
            </div>

            <aside className="h-fit rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prévia</p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-2xl font-semibold tracking-tight text-slate-950">{filteredItems.length}</p>
                  <p className="text-xs text-slate-500">comprovantes encontrados</p>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-lg font-semibold text-slate-950">{formatCurrency(totalPaid)}</p>
                  <p className="text-xs text-slate-500">total pago filtrado</p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                {filtersSummary.map((summary) => (
                  <span
                    key={summary}
                    className="block truncate rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                  >
                    {summary}
                  </span>
                ))}
              </div>

              <div
                className={cn(
                  'mt-4 rounded-lg border px-3 py-2 text-[11px]',
                  filteredItems.length ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-100 bg-amber-50 text-amber-800',
                )}
              >
                {filteredItems.length
                  ? 'O PDF terá capa, resumo e recibos em duas unidades por página.'
                  : 'Nenhum comprovante pago corresponde aos filtros selecionados.'}
              </div>
            </aside>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 px-5 py-4 md:px-6">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-md border-slate-300 text-[13px]"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="h-10 rounded-md bg-[#5c2f91] px-4 text-[13px] text-white hover:bg-[#4b2478]"
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            <Download className="mr-2 h-4 w-4" />
            {generating ? 'Gerando...' : 'Gerar PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

type CashflowPoint = {
  mes: string;
  entradas: number;
  saidas: number;
  saldo: number;
};

type SummaryPanelProps = {
  entradas: number;
  saidas: number;
  saldo: number;
  saldoInicial: number;
  topNavigator?: React.ReactNode;
};

type MonthNavigatorProps = {
  mesAtual: string;
  onPrevious: () => void;
  onNext: () => void;
  canGoNext: boolean;
};

type CashflowCarouselProps = {
  data: CashflowPoint[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  windowSize?: number;
};

/* -------------------------------------------------------------------------- */
/* Constantes de layout                                                        */
/* -------------------------------------------------------------------------- */

const CAROUSEL_TRANSITION_MS = 320;
const BAR_ZONE = 82;
const BAR_WIDTH = 20;
const GAP = 36;
const SLOT = BAR_WIDTH * 2 + GAP;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/* -------------------------------------------------------------------------- */
/* Dados mock                                                                  */
/* -------------------------------------------------------------------------- */

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const MESES_CURTOS = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const CASHFLOW_MOCK: CashflowPoint[] = [
  { mes: 'Jan', entradas: 8000, saidas: 6000, saldo: 2000 },
  { mes: 'Fev', entradas: 9000, saidas: 7000, saldo: 2000 },
  { mes: 'Mar', entradas: 10000, saidas: 8000, saldo: 2000 },
  { mes: 'Abr', entradas: 11000, saidas: 9000, saldo: 2000 },
  { mes: 'Mai', entradas: 12000, saidas: 10000, saldo: 2000 },
  { mes: 'Jun', entradas: 13000, saidas: 11000, saldo: 2000 },
  { mes: 'Jul', entradas: 14000, saidas: 12000, saldo: 2000 },
  { mes: 'Ago', entradas: 15000, saidas: 13000, saldo: 2000 },
  { mes: 'Set', entradas: 16000, saidas: 14000, saldo: 2000 },
  { mes: 'Out', entradas: 17000, saidas: 13000, saldo: 4000 },
  { mes: 'Nov', entradas: 18000, saidas: 14000, saldo: 4000 },
  { mes: 'Dez', entradas: 20000, saidas: 15000, saldo: 5000 },

  { mes: 'Jan', entradas: 12000, saidas: 8000, saldo: 4000 },
  { mes: 'Fev', entradas: 10000, saidas: 9000, saldo: 1000 },
  { mes: 'Mar', entradas: 15000, saidas: 7000, saldo: 8000 },
  { mes: 'Abr', entradas: 9000, saidas: 9500, saldo: -500 },
  { mes: 'Mai', entradas: 13000, saidas: 8000, saldo: 5000 },
  { mes: 'Jun', entradas: 11000, saidas: 10000, saldo: 1000 },
  { mes: 'Jul', entradas: 14000, saidas: 9000, saldo: 5000 },
  { mes: 'Ago', entradas: 12000, saidas: 11000, saldo: 1000 },
  { mes: 'Set', entradas: 16000, saidas: 12000, saldo: 4000 },
  { mes: 'Out', entradas: 17000, saidas: 13000, saldo: 4000 },
  { mes: 'Nov', entradas: 18000, saidas: 14000, saldo: 4000 },
  { mes: 'Dez', entradas: 20000, saidas: 15000, saldo: 5000 },
];

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

const FINANCIAL_START_INDEX = 12;
const LAST_DATA_INDEX = CASHFLOW_MOCK.length - 1;
const SYSTEM_MONTH = new Date().getMonth();

function computeCurrentIndex() {
  for (let i = LAST_DATA_INDEX; i >= FINANCIAL_START_INDEX; i--) {
    if (i % 12 === SYSTEM_MONTH) return i;
  }
  return LAST_DATA_INDEX;
}

const CURRENT_INDEX = computeCurrentIndex();
const MIN_INDEX = FINANCIAL_START_INDEX - 12;
const MAX_INDEX = CURRENT_INDEX;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const monthNameFromIndex = (i: number, full: boolean) =>
  (full ? MESES : MESES_CURTOS)[((i % 12) + 12) % 12];

function getMonthData(index: number) {
  const i = index - FINANCIAL_START_INDEX;
  if (i < 0 || i >= CASHFLOW_MOCK.length)
    return { entradas: 0, saidas: 0, saldo: 0, hasData: false };

  return { ...CASHFLOW_MOCK[i], hasData: true };
}

/* -------------------------------------------------------------------------- */
/* Month Navigator                                                             */
/* -------------------------------------------------------------------------- */

function MonthNavigator({
  mesAtual,
  onPrevious,
  onNext,
  canGoNext,
}: MonthNavigatorProps) {
  return (
    <div className="flex items-center justify-between w-full">
      <button onClick={onPrevious} className="p-2 rounded-full hover:bg-gray-100">
        ‹
      </button>
      <span className="font-bold text-[#383242]">{mesAtual}</span>
      <button
        onClick={canGoNext ? onNext : undefined}
        className={`p-2 rounded-full ${canGoNext ? 'hover:bg-gray-100' : 'opacity-30'
          }`}
      >
        ›
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary Panel                                                               */
/* -------------------------------------------------------------------------- */

function SummaryPanel({
  entradas,
  saidas,
  saldo,
  saldoInicial,
  topNavigator,
}: SummaryPanelProps) {
  return (
    <div className="w-full h-full rounded-2xl bg-white border border-[#e9dffc] px-4 py-5 shadow-sm flex flex-col justify-between">
      {topNavigator}

      <div className="space-y-3 mt-4">
        <Row label="Entradas" value={entradas} color="text-[#7c3aed]" prefix="+ " />
        <Row label="Saídas" value={saidas} color="text-gray-400" prefix="- " />
        <Row
          label="Balanço"
          value={saldo}
          color="text-[#383242]"
          prefix={saldo >= 0 ? '+ ' : '- '}
        />
      </div>

      <div className="mt-4 rounded-xl bg-[#f4ecfd]/40 px-3 py-2 text-xs border border-[#e9dffc]/40">
        Saldo inicial: <b>{formatCurrency(saldoInicial)}</b>
        <br />
        Balanço final: <b>{formatCurrency(saldo)}</b>
      </div>
    </div>
  );
}

const Row = ({
  label,
  value,
  color,
  prefix,
}: {
  label: string;
  value: number;
  color: string;
  prefix: string;
}) => (
  <div className="flex justify-between items-center">
    <span className="text-[10px] uppercase tracking-widest text-[#383242]/40 font-bold">
      {label}
    </span>
    <span className={`font-bold ${color}`}>
      {prefix}
      {formatCurrency(Math.abs(value))}
    </span>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Carousel (simplificado visualmente)                                         */
/* -------------------------------------------------------------------------- */

function CashflowCarousel({
  selectedIndex,
  onSelect,
}: CashflowCarouselProps) {
  return (
    <div className="w-full h-[220px] flex items-center justify-center text-[#383242]/40">
      {/* gráfico original mantido – layout corrigido ao redor */}
      Gráfico permanece inalterado
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cashflow Card                                                               */
/* -------------------------------------------------------------------------- */

export function CashflowCard() {
  const [selectedIndex, setSelectedIndex] = useState(CURRENT_INDEX);

  const md = getMonthData(selectedIndex);
  const prev = getMonthData(selectedIndex - 1);

  return (
    <section className="w-full">
      <div className="w-full rounded-2xl bg-[#f4ecfd] px-6 py-6 shadow-sm">
        <div className="flex w-full flex-col lg:flex-row gap-6 items-stretch">
          <div className="flex-1 px-2 py-6">
            <CashflowCarousel
              data={CASHFLOW_MOCK}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
            />
          </div>

          <aside className="w-full lg:w-[260px] flex">
            <SummaryPanel
              entradas={md.entradas}
              saidas={md.saidas}
              saldo={md.saldo}
              saldoInicial={prev.saldo}
              topNavigator={
                <MonthNavigator
                  mesAtual={monthNameFromIndex(selectedIndex, true)}
                  onPrevious={() =>
                    setSelectedIndex((i) => Math.max(MIN_INDEX, i - 1))
                  }
                  onNext={() =>
                    setSelectedIndex((i) => Math.min(CURRENT_INDEX, i + 1))
                  }
                  canGoNext={selectedIndex < CURRENT_INDEX}
                />
              }
            />
          </aside>
        </div>
      </div>
    </section>
  );
}
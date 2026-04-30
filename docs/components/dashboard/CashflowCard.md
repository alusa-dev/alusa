# CashflowCard

## Visão Geral

O `CashflowCard` é um componente React que exibe o fluxo de caixa mensal em formato de carrossel interativo, com visualização de entradas, saídas e saldo mês a mês. Ele combina um gráfico de velas (barras) com uma linha contínua de saldo, além de um painel de resumo detalhado e navegação entre meses.

---

## Estrutura do Componente

- **CashflowCard**: componente principal, responsável pelo estado do mês selecionado e integração dos subcomponentes.
- **CashflowCarousel**: carrossel visual com barras de entradas/saídas e linha de saldo, permite navegação por arraste e clique.
- **SummaryPanel**: painel lateral que mostra os totais de entradas, saídas, saldo e saldo inicial do mês selecionado.
- **MonthNavigator**: navegação entre meses, com botões para avançar/retroceder e exibição do mês atual.

---

## Props e Tipos

- `CashflowPoint`: representa os dados de um mês (mes, entradas, saidas, saldo).
- `CashflowCarouselProps`: dados do carrossel, índice selecionado, callback de seleção e tamanho da janela.
- `SummaryPanelProps`: valores de entradas, saídas, saldo, saldo inicial e componente de navegação.
- `MonthNavigatorProps`: mês atual, callbacks de navegação e controle de avanço.

---


## Funcionamento

- O carrossel exibe múltiplos meses, com barras para entradas/saídas e uma linha contínua para o saldo.
- O usuário pode navegar entre meses por clique, arraste ou pelos botões do `MonthNavigator`.
- O painel lateral mostra os totais do mês selecionado e o saldo inicial/final.
- O tooltip exibe o saldo do mês ao passar ou selecionar.
- O componente é responsivo e utiliza TailwindCSS para estilização.

---

## Carrossel: Implementação e Código

O carrossel é implementado pelo componente `CashflowCarousel`, responsável por renderizar as barras de entradas/saídas, a linha de saldo (SVG), o tooltip e toda a lógica de navegação (clique, arraste, seleção).

### Principais pontos da função:

- **Cálculo de geometria**: calcula altura das barras, posição X/Y, normalização de valores e limites de navegação.
- **Linha de saldo**: utiliza a função `catmullRom2bezier` para suavizar a linha SVG.
- **Arraste**: usa refs para controlar início/fim do drag e atualizar o índice selecionado conforme o deslocamento.
- **Tooltip**: exibe o saldo do mês selecionado, ajustando posição para não sair da área visível.
- **Responsividade**: calcula largura do gráfico e do track conforme o tamanho da janela e quantidade de meses.

### Código principal do carrossel

```tsx
function CashflowCarousel({
  data,
  selectedIndex,
  onSelect,
  windowSize = 7,
}: CashflowCarouselProps) {
  const chartHeight = BAR_ZONE * 2 + 36;
  const zeroY = chartHeight / 2;

  const hasMountedRef = useRef(false);
  useEffect(() => { hasMountedRef.current = true; }, []);
  const isDraggingRef = useRef(false);

  // Tooltip size
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      setTooltipSize({ width: rect.width, height: rect.height });
    }
  }, [selectedIndex]);

  const indices = useMemo(() => {
    const arr: number[] = [];
    for (let i = MIN_INDEX; i <= MAX_INDEX; i++) arr.push(i);
    return arr;
  }, []);

  const trackLength = indices.length;
  const trackWidth = trackLength * (BAR_WIDTH * 2) + (trackLength - 1) * GAP;
  const chartWidth = windowSize * (BAR_WIDTH * 2) + (windowSize - 1) * GAP;

  const half = Math.floor(windowSize / 2);
  let startVis = selectedIndex - half;
  if (startVis < MIN_INDEX) startVis = MIN_INDEX;
  if (startVis + windowSize - 1 > CURRENT_INDEX) {
    startVis = Math.max(MIN_INDEX, CURRENT_INDEX - windowSize + 1);
  }

  const lineMax = useMemo(() => {
    const valores = indices.map((idx) => Math.abs(getSaldoAtIndex(idx)));
    return valores.length ? Math.max(...valores, 1) : 1;
  }, [indices]);

  const maxValue = useMemo(() => {
    const valores: number[] = [];
    indices.forEach((index) => {
      const md = getMonthDataFromArray(index);
      if (md.hasData) {
        valores.push(Math.abs(md.entradas), Math.abs(md.saidas));
      }
    });
    return valores.length ? Math.max(...valores, 1) : 1;
  }, [indices]);

  const candles: CandleGeometry[] = useMemo(
    () =>
      indices.map((idx, order) => {
        const md = getMonthDataFromArray(idx);
        const isFuture = idx > CURRENT_INDEX;
        const showBars = md.hasData && idx >= FINANCIAL_START_INDEX && !isFuture;

        const entradaHeight = showBars
          ? Math.max((Math.abs(md.entradas) / maxValue) * BAR_ZONE, 4)
          : 0;

        const saidaHeight = showBars
          ? Math.max((Math.abs(md.saidas) / maxValue) * BAR_ZONE, 4)
          : 0;

        const xCenter = order * SLOT + BAR_WIDTH;
        const saldo = idx < FINANCIAL_START_INDEX ? 0 : getSaldoAtIndex(idx);
        const yLine = zeroY - (saldo / lineMax) * BAR_ZONE;

        return {
          index: idx,
          order,
          isFuture,
          showBars,
          entradaHeight,
          saidaHeight,
          xCenter,
          yLine,
        };
      }),
    [indices, maxValue, lineMax, zeroY],
  );

  const balancePath = useMemo(
    () => catmullRom2bezier(candles.map((c) => [c.xCenter, c.yLine])),
    [candles],
  );

  const baseOffset = (startVis - MIN_INDEX) * SLOT;
  const translateX = -baseOffset;
  const shouldAnimate = hasMountedRef.current && !isDraggingRef.current;

  // Drag logic
  const dragStartXRef = useRef<number | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartXRef.current = e.clientX;
    dragStartIndexRef.current = selectedIndex;
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current == null || dragStartIndexRef.current == null) return;
    const deltaX = e.clientX - dragStartXRef.current;
    const steps = Math.round(deltaX / SLOT);
    const baseIndex = dragStartIndexRef.current;
    const targetIndex = clamp(baseIndex - steps, MIN_INDEX, CURRENT_INDEX);
    if (targetIndex !== selectedIndex) {
      onSelect(targetIndex);
    }
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartXRef.current = null;
    dragStartIndexRef.current = null;
    isDraggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // ...renderização do JSX omitida para foco na lógica...
}
```

---

---

## Lógica e Helpers

- **Mock de dados**: `CASHFLOW_MOCK` simula os dados de fluxo de caixa.
- **Cálculo de índices**: controla o mês atual, limites de navegação e normalização de meses.
- **Helpers**: funções para formatação de moeda, nomes de meses, cálculo de saldo e geometria das barras.
- **catmullRom2bezier**: gera o path SVG suave para a linha de saldo.

---

## Interatividade

- Navegação por clique nas barras ou botões.
- Arraste horizontal para navegar entre meses.
- Tooltip dinâmico sobre o saldo do mês.
- Feedback visual para mês selecionado e meses futuros/desabilitados.

---

## Estilização

- Cores e espaçamentos definidos para clareza visual.
- Responsivo para desktop e mobile.
- Utiliza classes utilitárias do TailwindCSS.

---

## Localização

- O componente está localizado em:
  - `apps/web/app/(app)/dashboard/components/CashflowCard.tsx`

---

## Observações

- O componente utiliza dados mockados, mas pode ser adaptado para consumir dados reais.
- Toda a lógica de layout, navegação e visualização está encapsulada nos próprios componentes.
- Não depende de bibliotecas externas além do React e TailwindCSS.

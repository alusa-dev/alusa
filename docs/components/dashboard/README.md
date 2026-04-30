# Documentação dos Componentes do Dashboard

## Visão Geral

Este documento detalha os componentes visuais do dashboard da Alusa, focando nos cards principais: Receita do Mês, Taxa de Matrícula, Total de Alunos e Em Atraso. Todos seguem padrões de design, responsividade, tipagem forte e integração vertical (backend + frontend).

---

## Componentes Criados

### 1. ReceitaMesCard
- **Arquivo:** `app/(app)/dashboard/components/ReceitaMesCard.tsx`
- **Props:**
  - `valorAtual: number` — Valor total do mês atual.
  - `variacaoPercentual: number | null` — Variação percentual (opcional).
  - `serie: number[]` — Série de dados para o gráfico.
  - `periodo: '1d' | '15d' | '30d' | null` — Período do filtro do gráfico.
  - `onPeriodoChange?: (periodo: '1d' | '15d' | '30d' | null) => void` — Callback do toggle.
- **Funções:**
  - `buildSparklinePath` — Gera o path SVG para o gráfico.
  - `formatCurrency` — Formata valores em BRL.
- **Layout:**
  - Fundo roxo (`bg-[#c4b5fd]`), texto roxo escuro, gráfico à direita, toggle de período abaixo do texto.
  - Responsivo: empilha em mobile, duas colunas em desktop.
- **Gráfico:**
  - Sparkline SVG com gradiente roxo, linha curva e ponto final.
  - Fallback de série por período para garantir visual sempre presente.
- **Toggle:**
  - Botões `1D`, `15D`, `30D` sem seleção inicial; clique seleciona/desmarca.

### 2. TaxaMatriculaCard
- **Arquivo:** `app/(app)/dashboard/components/TaxaMatriculaCard.tsx`
- **Props:**
  - `valorPago: number` — Valor total pago no período.
  - `serie: number[] | undefined` — Série de dados para o gráfico.
  - `periodo: '7d' | '30d' | '1a' | null` — Período do filtro do gráfico.
  - `onPeriodoChange?: (periodo: '7d' | '30d' | '1a' | null) => void` — Callback do toggle.
- **Layout:**
  - Fundo roxo, texto roxo escuro, gráfico à direita, toggle de período abaixo do texto.
- **Gráfico:**
  - Sparkline SVG roxo, igual ao ReceitaMesCard.
  - Fallback de série por período.
- **Toggle:**
  - Botões `7D`, `30D`, `1A` sem seleção inicial; clique seleciona/desmarca.

### 3. EmAtrasoCard
- **Arquivo:** `app/(app)/dashboard/components/EmAtrasoCard.tsx`
- **Props:**
  - `quantidadeEmAtraso: number` — Quantidade de cobranças em atraso.
  - `serie?: number[]` — Série de dados para o gráfico.
- **Estado interno:**
  - `periodo: '7d' | '30d' | '1a' | null` — Controla o filtro do gráfico.
- **Layout:**
  - Fundo roxo, texto roxo escuro, gráfico à direita, toggle de período abaixo do texto.
  - Subtítulo pequeno: `0,0% de inadimplência` abaixo do número principal.
- **Gráfico:**
  - Sparkline SVG roxo, igual aos demais cards.
  - Fallback de série por período.
- **Toggle:**
  - Botões `7D`, `30D`, `1A` sem seleção inicial; clique seleciona/desmarca.

### 4. TotalAlunosCard
- **Arquivo:** `app/(app)/dashboard/components/TotalAlunosCard.tsx`
- **Props:**
  - `total: number` — Total de alunos.
  - `recentStudents: { id, name, avatarUrl, initials }[]` — Lista de alunos recentes.
  - `onAddAluno: () => void` — Callback para adicionar aluno.
- **Layout:**
  - Fundo roxo, texto roxo escuro, avatares dos alunos recentes, botão de adicionar.
  - Sem gráfico ou toggle.

---

## Padrões Visuais e Técnicos
- **Cores:**
  - Fundo: `bg-[#c4b5fd]` (roxo claro)
  - Texto principal: `text-[#2D004A]` (roxo escuro)
  - Gráfico: gradiente e linha roxa
- **Responsividade:**
  - Mobile-first, empilhando conteúdo em telas pequenas.
  - `flex flex-col md:flex-row`, `gap-4`, `px-5 py-4`, `min-h-[140px]`
- **Tipagem:**
  - TypeScript estrito, sem uso de `any`.
  - Props e tipos exportados.
- **Fallbacks:**
  - Séries de dados mock para garantir visual sempre presente.
- **Toggle:**
  - Sem seleção inicial, clique alterna estado.
- **Integração:**
  - Todos os cards recebem dados do `DashboardClient`.
  - Estado de período controlado por prop ou local.

---

## Como Usar

1. **Importe o componente desejado:**
   ```tsx
   import { ReceitaMesCard } from "./components/ReceitaMesCard";
   import { TaxaMatriculaCard } from "./components/TaxaMatriculaCard";
   import { EmAtrasoCard } from "./components/EmAtrasoCard";
   import { TotalAlunosCard } from "./components/TotalAlunosCard";
   ```

2. **Passe as props obrigatórias:**
   ```tsx
   <ReceitaMesCard
     valorAtual={receitaMes}
     variacaoPercentual={variacao}
     serie={serieReceita}
     periodo={periodoReceita}
     onPeriodoChange={setPeriodoReceita}
   />
   <TaxaMatriculaCard
     valorPago={valorPago}
     serie={serieTaxa}
     periodo={periodoTaxa}
     onPeriodoChange={setPeriodoTaxa}
   />
   <EmAtrasoCard
     quantidadeEmAtraso={cobrancasVencidas}
     serie={serieAtraso}
   />
   <TotalAlunosCard
     total={totalAlunos}
     recentStudents={alunosRecentes}
     onAddAluno={handleAddAluno}
   />
   ```

3. **Integre no dashboard:**
   - Os cards são usados em grid, lado a lado, dentro do `DashboardClient`.
   - O estado de período pode ser controlado localmente ou via prop.

---

## Observações
- Todos os componentes seguem boas práticas de clean code, tipagem forte, responsividade e UX.
- O layout, cores e interações são padronizados para garantir consistência visual.
- O gráfico sparkline é sempre exibido, mesmo sem dados reais, graças aos fallbacks.
- O toggle nunca vem pré-selecionado, e o usuário pode alternar ou desmarcar o filtro.
- O card de “Em atraso” exibe o subtítulo de inadimplência em fonte pequena.

---

## Manutenção
- Para alterar cores, ajuste as classes Tailwind nos componentes.
- Para integrar dados reais, passe as séries corretas via props.
- Para adicionar novos cards, siga o padrão de estrutura, tipagem e layout dos existentes.

---

## Referências
- [Tailwind CSS](https://tailwindcss.com/)
- [Next.js](https://nextjs.org/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)

---

_Última atualização: 19/11/2025_

# Design System Alusa

> Fonte de verdade visual e de composição da Alusa. Este documento registra os padrões de interface e experiência que devem orientar novas telas, componentes e fluxos do ERP Educacional.

**Status:** versão inicial consolidada a partir da interface existente e dos padrões mapeados no código.
**Escopo:** `apps/web`, com referências complementares a `packages/ui`.
**Princípio de manutenção:** este documento descreve decisões de design e composição; os componentes reutilizáveis continuam sendo implementados em `packages/ui` ou nos componentes compartilhados da aplicação.

## 1. Propósito

A Alusa é um ERP Educacional multi-tenant. Sua interface deve apoiar rotinas administrativas, acadêmicas, operacionais e financeiras de escolas com clareza, previsibilidade e baixa carga cognitiva.

O Design System existe para:

- preservar uma linguagem visual consistente entre Cadastro, Matrículas, Contratos, Cobranças, Financeiro, Aulas, Loja, Eventos e Portal;
- reduzir decisões visuais repetidas em cada nova feature;
- orientar o Codex e as pessoas desenvolvedoras a reutilizar padrões existentes;
- tornar explícitas as decisões de UX, não apenas os valores de cor;
- permitir evolução controlada sem quebrar fluxos administrativos, acadêmicos ou financeiros.

## 2. Princípios de interface

### Clareza operacional

Cada tela deve deixar evidente:

- onde o usuário está;
- qual tarefa pode executar;
- quais dados são mais importantes;
- qual é o próximo passo;
- o que aconteceu após uma ação.

### Baixa carga cognitiva

Preferir uma composição limpa, com poucos níveis de destaque, espaçamento generoso e ações contextuais. Não adicionar elementos decorativos que concorram com dados de alunos, matrículas, contratos ou cobranças.

### Consistência antes da novidade

Um padrão existente deve ser reutilizado mesmo quando uma alternativa nova parecer visualmente interessante. Novos padrões só devem ser introduzidos quando houver uma necessidade real de produto e quando puderem ser aplicados de forma recorrente.

### Contexto educacional

A interface deve refletir os objetos e os fluxos da Alusa: aluno, responsável, matrícula, turma, plano, contrato, cobrança, pagamento, aula, estoque e eventos. A UI não deve tratar esses fluxos como um CRUD genérico desconectado do contexto escolar.

### Estados visíveis e seguros

Loading, vazio, erro, sucesso, pendência, indisponibilidade e ações destrutivas precisam ter representação visual e textual clara. Operações financeiras críticas não devem parecer concluídas antes da confirmação do estado local ou do processamento externo aplicável.

## 3. Arquitetura visual

```txt
docs/DESIGN_SYSTEM.md  → decisões, linguagem visual e regras de composição
packages/ui            → primitivas e componentes reutilizáveis
apps/web/components    → componentes compartilhados da aplicação web
apps/web/features      → composição específica de cada domínio
Tailwind/configuração  → tokens técnicos e utilitários
Storybook (futuro)     → catálogo visual e interativo, quando necessário
```

As primitivas devem ser compostas nas features. Regras de negócio acadêmicas e financeiras não devem ser transferidas para componentes visuais.

### Referências principais da implementação

- [Tailwind da aplicação](/Users/blendstudio/Projects/alusa/apps/web/tailwind.config.js)
- [Tokens e regras globais](/Users/blendstudio/Projects/alusa/apps/web/app/globals.css)
- [Botão web](/Users/blendstudio/Projects/alusa/apps/web/components/ui/button.tsx)
- [Input web](/Users/blendstudio/Projects/alusa/apps/web/components/ui/input.tsx)
- [Select web](/Users/blendstudio/Projects/alusa/apps/web/components/ui/select.tsx)
- [Tabs web](/Users/blendstudio/Projects/alusa/apps/web/components/ui/tabs.tsx)
- [Dialog web](/Users/blendstudio/Projects/alusa/apps/web/components/ui/dialog.tsx)
- [Layout de tabelas](/Users/blendstudio/Projects/alusa/apps/web/components/layout/TableLayout.tsx)
- [DataTable](/Users/blendstudio/Projects/alusa/apps/web/components/layout/DataTable.tsx)
- [Estilos de tabela](/Users/blendstudio/Projects/alusa/apps/web/components/layout/TableStyles.ts)

## 4. Tokens e fundamentos

### 4.1 Fonte

A fonte principal da aplicação web é Inter, com fallback para `system-ui` e `sans-serif`.

```js
fontFamily.sans = ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif']
fontFamily.display = ['var(--font-display)', 'var(--font-inter)', 'Inter', 'system-ui', 'sans-serif']
```

### 4.2 Escala tipográfica existente

| Uso | Valor atual | Peso | Cor/referência |
| --- | ---: | ---: | --- |
| Título de página administrativa | `22px` mobile / `24px` desktop | `600` | `gray-900` |
| Título de detalhe | `30px` | `700` | `gray-900` |
| Título de dashboard | `24px` | `600` | `gray-900` |
| Título de seção | `14px` | `600` | `slate-700` |
| Texto auxiliar de página | `13px` | `400` | `gray-500` |
| Texto auxiliar ampliado | `14px` ou `16px` | `400` | `gray-600` |
| Label de formulário | `12px` | `500` | `slate-600` |
| Texto de tabela | `13px` ou `14px` | `400` | `gray-700` / `slate-700` |
| Cabeçalho de tabela | `12px` | `500` | `gray-500` / `slate-500` |
| Botão padrão | `14px` | `500` | conforme variante |
| Ação compacta de KPI | `12px` | `400` | conforme superfície |
| Valor de KPI comum | `37px` | `400` | `#3d3a3f` |
| Valor de KPI de alunos | `48px` | `400` | `#3d3a3f` |

Usar `tracking-tight` em títulos e `leading-tight` ou `leading-none` apenas quando o componente já tiver esse padrão definido.

### 4.3 Cores da marca e superfícies claras

Os valores abaixo são os valores reais encontrados na implementação atual. Eles devem ser reutilizados antes de qualquer nova cor ser criada.

| Token/referência | Valor | Uso observado |
| --- | --- | --- |
| `brand.DEFAULT` / `primary` | `#5c2f91` | roxo principal semântico, ações primárias |
| `brand.light` | `#7243aa` | variação clara da marca |
| `brand.selected` / `violet.700` | `#4b217a` | seleção escura/hover específico |
| `brand-bg` / `brand-accent` legado | `#3e1f63` | valores legados no Tailwind |
| `alusa-purple` | `#340e63` | marca institucional e área pública |
| `alusa-purple-hover` | `#280a4d` | hover institucional |
| `brand-primary` / `alusa-purple-deeper` | `#19143A` / `#0F0C26` | superfícies escuras legadas |
| KPI principal de alunos | `#e2d1f8` | card “Alunos ativos” |
| KPI comum | `#f2e9fc` | cards de métricas do dashboard |
| Métrica financeira/superfície lilás | `#f4ecfd` | cards financeiros e áreas lilás |
| Controle de período | `#eadcf8` | container do toggle `1A/30D/15D` |
| Seleção ativa clara | `#f8f3fd` | opção ativa do período |
| Seleção de card | `#e6d6fb` | card selecionado em vendas |
| Fundo neutro | `#f9fafb` / `gray-50` | cabeçalhos, estados e áreas auxiliares |
| Fundo de seção | `#f8fafc` / `slate-50` | formulários e detalhes |
| Fundo branco | `#ffffff` | cards, tabelas, inputs e modais |

#### Conflito que deve ser observado

O `tailwind.config.js` possui simultaneamente:

- `brand-accent: '#3e1f63'` no nível superior;
- `brand.accent: '#5c2f91'` no objeto `brand`;
- `primary.DEFAULT: '#5c2f91'`.

Como o Tailwind achata chaves de cores aninhadas para gerar utilitários, `brand-accent` e `brand.accent` podem disputar o mesmo nome de classe (`bg-brand-accent`) apesar de terem valores diferentes no arquivo de configuração. Em novas implementações, preferir o token semântico `primary` ou confirmar a classe gerada antes de reutilizar `brand-accent`. A consolidação desse conflito deve ser feita em uma mudança técnica própria, com validação visual.

A Agenda possui tokens semânticos próprios para diferenciar tipos de ocorrência e estados temporais. Eles ficam em `apps/web/app/globals.css` com o prefixo `--calendar-event-*` e devem ser usados por novas visualizações de agenda, evitando novos hexadecimais dentro dos componentes.

### 4.4 Texto, bordas e estados semânticos

| Função | Valor atual |
| --- | --- |
| Texto primário claro | `#111827` / `gray-900` |
| Texto secundário | `#475569` / `slate-600` |
| Texto auxiliar | `#6b7280` / `gray-500` |
| Texto de KPI | `#3d3a3f` |
| Texto financeiro | `#2b2634` |
| Borda clara principal | `#e2e8f0` / `slate-200` |
| Borda clara de tabela | `#e5e7eb` / `gray-200` |
| Borda clara sutil | `#f1f5f9` / `slate-100` |
| Sucesso principal | `#22c55e` / `green-500` |
| Indicador “Atualizado” | `#38C256` |
| Perigo | `#ef4444` / `red-500` |
| Atenção | `#f59e0b` / `amber-500` |
| Informação | `#60a5fa` |

### 4.5 Tema escuro

O tema escuro usa tokens CSS em `apps/web/app/globals.css`. Componentes novos devem preferir os tokens semânticos do tema quando houver suporte:

```css
--color-bg-page: #0d1015;
--color-bg-sidebar: #0b0d12;
--color-bg-surface: #101317;
--color-bg-card: #15161e;
--color-bg-card-soft: #1c1b29;
--color-bg-elevated: #21202d;
--color-text-primary: #f5f3f8;
--color-text-secondary: #c9c3d3;
--color-text-muted: #8d8797;
--color-border-subtle: #252833;
--color-border-default: #32323e;
--color-border-strong: #524d5a;
--color-button-primary-bg: #36274e;
--color-button-primary-hover: #553b71;
```

Não criar uma segunda paleta escura localmente em uma feature.

### 4.6 Loading padrão da aplicação

O loading padrão da Alusa é a logo `alusa` em cinza claro, centralizada na área que está sendo carregada. A implementação oficial é [AlusaLogoLoader](/Users/blendstudio/Projects/alusa/apps/web/components/feedback/AlusaLogoLoader.tsx).

Usar esse padrão quando o carregamento bloquear uma página inteira, uma área principal sem conteúdo identificável ou uma transição de tela. A logo deve:

- ficar centralizada horizontal e verticalmente na superfície disponível;
- usar a máscara oficial `/brand/logo-sidebar-mask.svg`;
- usar a cor cinza `#dfe4e9`;
- apresentar animação suave de pulsação (`animate-pulse`), respeitando `prefers-reduced-motion`;
- expor `role="status"` e `aria-label="Carregando"`;
- permanecer sobre fundo branco, sem spinner adicional, skeleton ou box decorativo concorrendo com a marca.

Exemplo para carregamento de uma área da aplicação:

```tsx
import { AlusaLogoLoader } from '@/components/feedback/AlusaLogoLoader';

return <AlusaLogoLoader className="min-h-[640px]" />;
```

Usar `fullScreen` somente quando toda a aplicação estiver indisponível durante a transição, como autenticação, logout ou uma navegação global:

```tsx
return <AlusaLogoLoader fullScreen />;
```

Skeletons são o padrão preferencial para carregamentos parciais. Use-os quando o contexto da tela, o cabeçalho ou a estrutura da área continuar visível enquanto os dados são buscados — por exemplo, lista de turmas, tabela, cards ou linhas de formulário. O skeleton deve reproduzir de forma discreta a geometria do conteúdo esperado e não deve substituir a tela inteira.

Também é permitido usar um estado textual contextual quando a área for simples e o texto explicar claramente o que está sendo carregado, como `Carregando turmas...`. Esse estado deve permanecer dentro da própria área, com alinhamento e espaçamento consistentes, sem spinner adicional.

Não aplicar automaticamente a logo da Alusa em todo loading. Não usar spinner isolado como loading principal de uma página; para carregamentos parciais, preferir skeleton ou mensagem contextual.

### 4.7 Escala de espaçamento

A interface atual usa principalmente a escala Tailwind baseada em múltiplos de `4px`:

| Token | Valor |
| --- | ---: |
| `1` | `4px` |
| `2` | `8px` |
| `3` | `12px` |
| `4` | `16px` |
| `5` | `20px` |
| `6` | `24px` |
| `7` | `28px` |
| `8` | `32px` |
| `section` | `5.5rem` |
| `section-lg` | `7rem` |

Padrões recorrentes:

- gap entre ícone e texto: `8px`;
- gap de campos em grids: `16px`;
- padding de controles: `12px` horizontal;
- padding de cards compactos: `16px`;
- padding de cards administrativos: `20px` ou `24px`;
- distância entre seções de detalhe: `32px`;
- distância entre título e descrição: `4px` ou `8px` conforme o componente.

### 4.8 Arredondamento e profundidade

| Uso | Valor atual |
| --- | ---: |
| Controle pequeno/botão padrão | `6px` (`rounded-md`) |
| Input, select e ações de filtro | `8px` (`rounded-lg`) |
| Card interno e modal de detalhe | `12px` (`rounded-xl`) |
| KPI e card de dashboard | `16px` (`rounded-2xl`) |
| Botão circular | `9999px` ou tamanho explicitamente circular |
| Card de autenticação | `40px` |

A profundidade padrão da aplicação administrativa é baseada em bordas sutis. Usar `shadow-sm` somente quando o componente existente já utiliza esse padrão ou quando a superfície precisar se separar do fundo. Evitar sombras grandes em tabelas, filtros e cards de operação.

## 5. Shell e layout de páginas

### 5.1 Página administrativa comum

O padrão de gestão utiliza:

1. shell da aplicação com sidebar e cabeçalho global;
2. título e descrição da página;
3. barra de ações, busca e filtros;
4. tabela ou grid principal;
5. paginação ou estados de carregamento/vazio.

O componente de referência é [TableLayout.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/layout/TableLayout.tsx).

### 5.2 Página de detalhe

Páginas de detalhe usam conteúdo centralizado, com largura máxima controlada e espaço lateral significativo.

```txt
shell da aplicação
└── área com rolagem vertical
    └── container externo: px-4 py-6 pb-8
        ├── botão Voltar
        ├── título e descrição
        └── seções empilhadas com space-y-8
```

Valores canônicos atuais:

- container horizontal: `px-4` — `16px`;
- padding superior: `py-6` — `24px`;
- padding inferior: `pb-8` — `32px`;
- largura máxima: `max-w-4xl` — `896px`;
- centralização: `mx-auto`;
- margem inferior do cabeçalho: `mb-8` — `32px`;
- distância entre seções: `space-y-8` — `32px`.

Referências: [AlunoDetalhesFeature.tsx](/Users/blendstudio/Projects/alusa/apps/web/features/cadastro/alunos/AlunoDetalhesFeature.tsx) e [MatriculaDetalhesClient.tsx](/Users/blendstudio/Projects/alusa/apps/web/app/(app)/matriculas/[id]/MatriculaDetalhesClient.tsx).

### 5.3 Responsividade

Os breakpoints Tailwind utilizados pela aplicação são:

```txt
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px
```

Comportamento esperado:

- mobile: uma coluna, ações empilhadas, controles com largura total;
- tablet: grids de duas colunas quando houver espaço;
- desktop: conteúdo agrupado em duas, três ou quatro colunas conforme a densidade do domínio;
- tabelas largas: manter estrutura e permitir rolagem horizontal, sem esconder dados essenciais;
- modais de formulário: ocupar a viewport no mobile quando o fluxo exigir edição extensa.

## 6. Cabeçalho de página e filtros

### 6.1 Cabeçalho de gestão

O cabeçalho de páginas como “Gestão de Alunos” segue:

- título: `22px` mobile / `24px` desktop, peso `600`, `tracking-tight`;
- descrição: `13px`, cor `gray-500`;
- espaço entre título e descrição: `4px`;
- layout desktop: `flex-row`, `justify-between`, gap `16px`;
- layout mobile: coluna, gap `12px`.

### 6.2 Barra de ações

- fundo: branco;
- borda: `1px solid #e2e8f0`;
- raio: `12px`;
- padding mobile: `12px`;
- padding desktop: `16px 24px`;
- ações à esquerda e busca/filtros à direita em desktop;
- no mobile, elementos ocupam a largura disponível.

### 6.3 Busca

Referência: [EntityFiltersBar.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/layout/EntityFiltersBar.tsx).

- altura: `40px`;
- raio: `8px`;
- borda: `#e2e8f0`;
- padding esquerdo: `40px`;
- ícone: `16px`, posicionado a `12px` da esquerda;
- cor do ícone: `#94a3b8`;
- largura desktop: `360px`, chegando a `420px` em `xl`;
- sombra: nenhuma;
- placeholder deve explicar o critério de busca.

### 6.4 Select e filtro

- altura: `40px`;
- raio: `8px`;
- borda: `#e2e8f0`;
- padding horizontal: `12px`;
- texto: `14px`;
- select de status: largura entre `150px` e `190px` no desktop;
- botão “Filtro”: padding horizontal `16px`, ícone `16px`, gap `8px`;
- hover de controles neutros: `#f8fafc`;
- menu de filtro: título em `11px`, caixa alta, peso `500`, `tracking-wide`.

Na Agenda, os filtros de turma, professor e sala seguem o mesmo controle de `40px` e `rounded-lg`; seus labels devem estar associados aos triggers por `htmlFor`/`id`.

## 7. Botões

O componente principal da aplicação é [button.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/ui/button.tsx), que usa variantes `default`, `destructive`, `outline`, `secondary`, `ghost` e `link`, além dos tamanhos `default`, `sm`, `lg` e `icon`.

### 7.1 Regras de uso

- `default`/primário: ação principal da tela ou do fluxo;
- `outline`: ação secundária, cancelar, voltar ou alternativa neutra;
- `secondary`: ação complementar com menor destaque;
- `ghost`: ação discreta, especialmente ícones e navegação contextual;
- `destructive`: remoção, cancelamento irreversível ou desativação com risco;
- `link`: navegação textual ou ação de baixa ênfase.

### 7.2 Medidas recorrentes

- botão padrão web: `36px` de altura (`h-9`);
- botão grande: `40px` (`h-10`);
- botão pequeno: `32px` (`h-8`);
- botão de formulário mobile: `44px` (`h-11`);
- padding padrão: `16px` horizontal;
- botão de ícone padrão: `36px × 36px`;
- ícones internos: `16px`;
- gap ícone/texto: `8px`.

### 7.3 Primário da Alusa

Nas telas administrativas, a intenção visual é:

```txt
fundo: primary / #5c2f91
texto: #ffffff
hover: primary com 90% de opacidade ou variante mais escura existente
sombra: nenhuma em ações administrativas principais
```

Antes de usar `bg-brand-accent`, observar o conflito documentado na seção de tokens.

## 8. Inputs, formulários e selects

### 8.1 Controle padrão

O padrão de formulário usado nos detalhes de aluno e matrícula é:

```txt
h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm
text-slate-900 shadow-sm transition
focus:border-[#A94DFF]
focus:ring-2 focus:ring-[#A94DFF]/30
```

Valores:

- altura: `40px`;
- raio: `8px`;
- padding horizontal: `12px`;
- texto: `14px`;
- borda: `#e2e8f0`;
- foco: `#A94DFF` com anel de `30%` de opacidade;
- disabled: não deve perder legibilidade nem parecer uma ação disponível.

### 8.2 Labels e ajuda

- label: `12px`, peso `500`, cor `#475569`;
- agrupamento label/controle: `space-y-1` quando compacto;
- descrição ou ajuda: `12px` ou `14px`, cor `slate-500`/`slate-600`;
- erro: texto curto, próximo ao campo, sem depender apenas de cor;
- campos obrigatórios devem indicar a obrigatoriedade de forma consistente.

### 8.3 Select

O componente [select.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/ui/select.tsx) usa:

- trigger com `h-10`, `rounded-lg`, `px-3`, `text-sm`;
- menu com `rounded-lg`, borda `gray-200`, fundo branco e `shadow-lg`;
- item com `rounded-md`, `px-3 py-2`, `text-sm`;
- item selecionado/destacado com fundo `gray-100`;
- ícone de chevron de `16px`.

## 9. Cards e KPIs

### 9.1 Card de KPI

Os cards do dashboard seguem uma composição de baixa densidade:

- altura: `219px`;
- raio: `16px`;
- padding horizontal: `20px`;
- padding superior: `16px`;
- padding inferior: `22px`;
- layout: coluna com `justify-between`;
- fundo comum: `#f2e9fc`;
- fundo destacado de alunos: `#e2d1f8`;
- borda clara: nenhuma;
- tema escuro: borda de `1px` usando `var(--color-border-default)`;
- valor comum: `37px`, peso `400`, `leading-none`;
- valor de alunos: `48px`, peso `400`, `leading-none`.

Referências: [TotalAlunosCard.tsx](/Users/blendstudio/Projects/alusa/apps/web/app/(app)/dashboard/components/TotalAlunosCard.tsx), [FinanceiroKpiCards.tsx](/Users/blendstudio/Projects/alusa/apps/web/app/(app)/dashboard/components/FinanceiroKpiCards.tsx) e [TaxaMatriculaCard.tsx](/Users/blendstudio/Projects/alusa/apps/web/app/(app)/dashboard/components/TaxaMatriculaCard.tsx).

### 9.2 Composição

Um KPI pode conter:

1. label curto;
2. valor principal;
3. status de atualização;
4. avatar group ou contexto auxiliar;
5. ação relacionada ao módulo;
6. filtro de período quando o indicador depender de janela temporal.

O card não deve receber texto explicativo extenso. Detalhes devem ficar em tooltip, descrição acessível ou tela de destino.

### 9.3 Status “Atualizado”

- altura: `24px`;
- padding horizontal: `12px`;
- raio: `9999px`;
- fundo: `rgba(0, 0, 0, 0.05)`;
- texto: `12px`;
- indicador: `8px × 8px`;
- indicador verde: `#38C256`;
- gap indicador/texto: `4px`.

### 9.4 Ação compacta de KPI

- altura: `24px`;
- padding horizontal: `12px`;
- raio: `9999px`;
- fundo: `#3d3a3f`;
- texto: `12px`;
- hover: `#26222d`.

## 10. Tabelas

### 10.1 Tabela administrativa padrão

Referências: [DataTable.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/layout/DataTable.tsx) e [TableStyles.ts](/Users/blendstudio/Projects/alusa/apps/web/components/layout/TableStyles.ts).

- container: fundo branco, borda `#e5e7eb`, `overflow-hidden`;
- raio mobile: `8px`;
- raio desktop: `12px`;
- cabeçalho: fundo `#f9fafb`;
- linhas: fundo branco, com divisórias sutis;
- hover de linha: `#f9fafb`;
- profundidade: flat, sem sombra forte.

### 10.2 Cabeçalho da tabela

- texto: `12px`;
- peso: `500`;
- cor: `#6b7280` ou `#64748b`;
- caixa alta quando o padrão da tabela usar rótulos de coluna;
- `tracking-wide`;
- padding mobile: `12px` horizontal e `10px` vertical;
- padding desktop: `24px` horizontal e `12px` vertical.

### 10.3 Linhas e células

- texto comum: `13px` ou `14px`;
- padding mobile: `12px`;
- padding desktop: `16px 24px`;
- divisórias: `#e5e7eb` ou `#f1f5f9` conforme o componente;
- dados numéricos: usar `tabular-nums` quando houver comparação vertical;
- ações: alinhadas à direita ou centralizadas na última coluna;
- dados longos: truncar apenas quando houver mecanismo de acesso ao conteúdo completo.

### 10.4 Distribuição de colunas

Para a tabela de alunos, a distribuição de referência é de 12 colunas:

```txt
nome       col-span-3
cpf        col-span-2
email      col-span-3
telefone   col-span-2
status     col-span-1
ações      col-span-1
```

### 10.5 Status na tabela

Status ativo:

```txt
background: #CFF2DA
color: #144E22
padding: 2px 10px
border-radius: 9999px
font-size: 10px
font-weight: 700
tracking: widest
```

Status inativo:

```txt
background: #FFD9B3
color: #5C2A00
```

### 10.6 Paginação

- área separada por borda superior;
- fundo: `#f9fafb`;
- padding vertical: `12px`;
- padding horizontal: `16px` mobile / `24px` desktop;
- item: mínimo de `32px × 32px`;
- item ativo: fundo `#e5e7eb`, texto `#111827`, formato circular;
- item inativo: fundo transparente;
- estados desabilitados usam opacidade reduzida e não dependem somente de cor.

## 11. Modais

### 11.1 Modal base

O modal base está em [dialog.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/ui/dialog.tsx).

- overlay: `rgba(0, 0, 0, 0.8)`;
- overlay com blur suave;
- conteúdo padrão: `max-w-lg`;
- fundo: branco;
- borda: `1px solid #e5e7eb`;
- padding padrão: `24px`;
- raio desktop: `12px`;
- sombra: `shadow-lg`;
- animação: fade + zoom;
- mobile com `fullScreenMobile`: ocupa `100dvh`, sem raio, sem bordas laterais e com rolagem interna.

### 11.2 Modal de formulário extenso

Referência: [AlunoEditDialog.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/alunos/AlunoEditDialog.tsx).

- largura: `max-w-4xl` — `896px`;
- fundo: `#f8fafc`;
- padding externo: `0`;
- raio desktop: `16px`;
- formulário com altura máxima de `88vh`;
- cabeçalho e rodapé fixos;
- corpo com `overflow-y-auto`;
- cabeçalho: padding desktop `24px 32px`;
- corpo: padding desktop horizontal `32px`, vertical `24px`;
- seções internas: `rounded-xl`, borda `slate-200`, fundo `slate-50`, `px-5 py-4`;
- rodapé: borda superior, padding `16px 32px`, ações alinhadas à direita.

### 11.3 Modal com tabela

Referência: modal “Detalhes da variante” em [ProductVariantsTab.tsx](/Users/blendstudio/Projects/alusa/apps/web/features/vendas/components/tabs/ProductVariantsTab.tsx).

- largura máxima: `896px`;
- altura máxima: `640px`;
- raio: `16px`;
- padding externo: `0`;
- cabeçalho: `px-6 pt-4`;
- corpo: `px-6 pt-3 pb-5`;
- tabela interna: borda `slate-200`, raio `12px`, `overflow-hidden`;
- cabeçalho da tabela: fundo `slate-50`, `px-4 py-3`;
- linhas: `px-4 py-4`, divisórias `slate-100`;
- cabeçalho sticky quando houver rolagem;
- modal pode ter ação por linha, mas a linha inteira só deve ser clicável quando isso for compreensível e acessível.

### 11.4 Modal de evento da Agenda

O modal de criação/edição de evento usa a composição de formulário extenso:

- largura: `max-w-4xl` — `896px`;
- raio: `rounded-2xl` — `16px`;
- controles: `h-10`, `rounded-lg`, `text-sm`, `shadow-sm`;
- seções: `rounded-xl`, borda `slate-200`, fundo lilás/neutro suave;
- labels: `12px`, peso `500`, sem caixa alta obrigatória;
- ações: `h-10`, `rounded-lg`, primário sem sombra forte.

Referência: [CalendarEventDialog.tsx](/Users/blendstudio/Projects/alusa/apps/web/features/aulas/agenda/components/CalendarEventDialog.tsx).

O modal “Nova reposição” segue o mesmo padrão visual e de acessibilidade, incluindo `max-w-4xl`, `rounded-2xl`, controles `h-10 rounded-lg`, seções `rounded-xl` e labels associados aos controles. Referência: [MakeupClassDialog.tsx](/Users/blendstudio/Projects/alusa/apps/web/features/aulas/reposicoes/components/MakeupClassDialog.tsx).

### 11.5 Modal de detalhes — leitura de dados

O modal mostrado em “Detalhes da rematrícula” é uma variação própria para consulta. Ele não deve ser tratado como modal de formulário: o conteúdo é organizado para leitura rápida, sem campos editáveis, com seções suaves e footer fixo.

Referência canônica: [DetailsDialog.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/shared/DetailsDialog.tsx). Exemplo de uso: [RematriculaProcessDialogs.tsx](/Users/blendstudio/Projects/alusa/apps/web/features/cadastro/rematriculas/components/RematriculaProcessDialogs.tsx).

#### Estrutura

```txt
overlay escuro
└── modal centralizado
    ├── header fixo: título + botão fechar
    ├── corpo rolável
    │   ├── resumo principal: label + valor destacado + metadados
    │   └── seções de dados em cards suaves
    └── footer fixo: ação “Fechar”
```

#### Medidas e superfícies

- largura: `max-w-[30rem]` — `480px`;
- altura máxima: `90vh`;
- fundo do modal, header, corpo e footer: `#ffffff`;
- borda: `1px solid #e2e8f0` (`slate-200`);
- raio externo: `rounded-xl` — `12px`;
- profundidade atual: `shadow-2xl`; esta é uma exceção do modal de leitura e não deve ser propagada para cards, tabelas ou toolbars;
- overlay: padrão global `rgba(0, 0, 0, 0.8)` com blur;
- botão fechar: posição `top-4 right-4`, área padrão do componente de diálogo.

#### Header

- padding superior: `24px` (`pt-6`);
- padding inferior: `20px` (`pb-5`);
- padding lateral esquerdo: `24px` (`px-6`);
- espaço reservado ao botão fechar: `56px` (`pr-14`);
- separador inferior: `1px solid #e2e8f0`;
- título: `18px`, peso `500`, `tracking-tight`, cor `#0f172a` (`slate-900`).

#### Corpo e resumo

- corpo com `flex-1`, `overflow-y-auto` e `scroll-smooth`;
- padding: `24px` (`px-6 py-6`);
- distância entre blocos: `24px` (`space-y-6`);
- label de resumo: `12px`, peso `400`, cor `#64748b` (`slate-500`);
- valor financeiro: `30px`, peso `500`, `tracking-tight`, cor `#020617` (`slate-950`);
- distância entre label e valor: `4px` (`mt-1`);
- status positivo observado: `#047857` (`emerald-700`).

#### Seções internas

Cada grupo de informações usa um card suave sem borda:

- fundo: `#f8fafc` (`slate-50`);
- raio: `rounded-xl` — `12px`;
- padding: `16px` (`px-4 py-4`);
- distância entre título e conteúdo: `12px` (`space-y-3`);
- título da seção: `14px`, peso `500`, cor `#0f172a`;
- não adicionar sombra ou borda às seções internas sem necessidade.

#### Linhas label/valor

- layout: `display: flex`, `justify-content: space-between`;
- gap: `16px` (`gap-4`);
- padding vertical: `6px` (`py-1.5`);
- label: largura `48%`, `12px`, peso `500`, cor `#64748b`;
- valor: largura `52%`, alinhamento à esquerda, `14px`, cor `#0f172a`;
- valores longos devem quebrar ou receber tratamento de truncamento acessível, sem deslocar o label.

#### Footer

- separador superior: `1px solid #e2e8f0`;
- fundo: `#ffffff`;
- padding: `16px 24px` (`px-6 py-4`);
- ação “Fechar”: altura `40px`, largura mínima `112px`, borda `#cbd5e1` (`slate-300`), fundo branco, texto `#334155` (`slate-700`);
- hover do botão: `#f8fafc` (`slate-50`);
- footer permanece fixo enquanto o corpo rola.

#### Quando usar

Usar este padrão quando a pessoa precisa consultar um resumo e detalhes relacionados sem editar o registro. Para criação ou edição, usar o modal de formulário extenso documentado na seção 11.2. Para ações com risco, usar confirmação destrutiva com ação explícita e sem transformar o modal de detalhes em formulário.

## 12. Seleções preenchidas

### 12.1 Card selecionado

Usado em “Buscar Cliente”, “Individual” e opções de matrícula:

- raio: `8px` ou `12px`, conforme o componente;
- padding: `12px`, `16px` ou `20px` conforme densidade;
- estado ativo: fundo lilás;
- estado inativo: branco com borda `slate-200`;
- hover: fundo `slate-50`;
- título: `14px` ou `16px`, peso `500`/`600`;
- descrição: `12px` ou `14px`, cor `slate-500`;
- seleção deve ter indicação adicional além do fundo quando necessário.

Valores existentes:

- card de cliente selecionado: `#e6d6fb`;
- opções de matrícula: `violet-200/80`;
- ícone selecionado: `#f4ecfd` com texto `#5c2f91`;
- indicador circular de seleção: `20px × 20px`, fundo `#5c2f91`, ícone `12px` branco.

### 12.2 Forma de pagamento

- grid de três opções;
- gap: `8px`;
- altura: `36px`;
- raio: `6px`;
- opção ativa: `violet-200/80`, borda transparente;
- opção inativa: fundo branco, borda `gray-200`;
- texto: `14px`, peso `500`, centralizado;
- opções atuais: `PIX`, `Boleto`, `Cartão`.

## 13. Tabs

Referência: [tabs.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/ui/tabs.tsx).

### Tabs segmentadas

- container: `inline-flex`;
- altura: `40px`;
- padding: `4px`;
- raio: `12px`;
- fundo de referência: `#f1f5f9` com `80%` de opacidade;
- tab: altura `32px`, raio `8px`, padding horizontal `16px`;
- texto: `14px`, peso `500`;
- tab inativa: texto `#64748b`;
- tab ativa: fundo branco, texto `#111827`;
- sombra ativa: `shadow-sm` no componente base, podendo ser removida em usos específicos;
- foco: anel `#A94DFF/30`.

### Tabs com linha

Variante `line`:

- altura: `42px`;
- gap: `16px`;
- borda inferior ativa: `2px`;
- cor ativa: `brand-accent`;
- fundo transparente.

## 14. Toggle de status

O toggle de status da tabela administrativa de usuários é um padrão diferente do componente genérico `Switch`.

Referência: [page.tsx](/Users/blendstudio/Projects/alusa/apps/web/app/(app)/admin/configuracoes/usuarios/page.tsx).

- largura: `44px`;
- altura: `24px`;
- padding: `2px`;
- raio: `9999px`;
- transição: `200ms ease-out`;
- estado desligado: fundo `#d1d5db`;
- estado ligado: fundo `#22c55e`;
- thumb: `20px × 20px`, branco, circular;
- thumb desligado: `translateX(0)`;
- thumb ligado: `translateX(20px)`;
- thumb: `shadow-sm` e anel `rgba(0, 0, 0, 0.05)`;
- desabilitado: cursor `not-allowed` e fundo cinza;
- acessibilidade: `role="switch"`, `aria-checked`, label acessível e suporte a `Space`/`Enter`.

O componente genérico [switch.tsx](/Users/blendstudio/Projects/alusa/apps/web/components/ui/switch.tsx) usa a mesma dimensão geral, mas possui tokens e comportamento próprios. Não substituir um pelo outro sem validar o contexto.

## 15. Badges, status e disponibilidade

### Badges semânticos

| Tom | Fundo | Texto |
| --- | --- | --- |
| neutro | `slate-100` | `slate-600` |
| sucesso | `emerald-100` | `emerald-800` |
| atenção | `amber-100` | `amber-800` |
| perigo | `rose-100` | `rose-800` |
| informação | `violet-100` | `violet-800` |

Padrão:

- `rounded-full`;
- padding `2px 10px`;
- texto `12px`;
- peso `600`.

### Disponibilidade de estoque

Para barras de disponibilidade:

- trilho: `8px`, circular;
- estoque baixo: trilho `amber-100`, barra `amber-500`, largura de referência `42%`;
- disponível: trilho `emerald-100`, barra `emerald-500`, largura `100%`;
- sem estoque: trilho `red-100`, barra `red-500`, largura `0%`.

## 16. Loading, vazio, erro e sucesso

### Loading

- preservar a geometria final do componente;
- usar skeleton em vez de spinner quando a estrutura já for conhecida;
- usar `animate-pulse` de forma discreta;
- não deslocar a página quando o conteúdo chegar.

### Empty state

- explicar o que está vazio;
- indicar, quando possível, como começar;
- manter o estado dentro do painel ou tabela correspondente;
- usar texto centralizado em tabelas, normalmente com `px-6 py-12` e `text-sm`.

### Erro

- mensagem curta e acionável;
- não expor stack trace, tokens ou detalhes internos;
- usar tom semântico de perigo/atenção;
- oferecer retry quando for seguro;
- diferenciar erro de carregamento, validação e indisponibilidade de integração.

### Toast e confirmação

Toasts devem confirmar uma mudança observável e não substituir a apresentação do estado persistido. Ações destrutivas ou financeiras exigem confirmação explícita quando houver risco de perda, cancelamento ou alteração relevante.

## 17. Acessibilidade

Toda nova interface deve observar, no mínimo:

- labels associados aos campos;
- foco visível para navegação por teclado;
- `aria-label` em controles de ícone;
- `aria-checked` em toggles;
- `aria-sort` em colunas ordenáveis;
- suporte a teclado em tabs, menus, toggles e ações;
- mensagens de erro próximas ao campo e legíveis;
- estados não comunicados somente por cor;
- áreas clicáveis adequadas, especialmente no mobile;
- contraste suficiente entre texto, fundo e estado;
- respeito a `prefers-reduced-motion`;
- `alt` descritivo em imagens de alunos, responsáveis e produtos.

Não remover foco de teclado globalmente para eliminar um halo visual de mouse. Quando houver diferença entre foco de mouse e foco de teclado, usar `:focus-visible` de forma localizada.

## 18. Domínio visual da Alusa

Os padrões devem usar nomenclatura coerente com o domínio:

| Conceito | Uso de interface |
| --- | --- |
| Aluno | cadastro, foto, status, detalhes e histórico acadêmico |
| Responsável | vínculo, responsabilidade financeira e contatos |
| Matrícula | período, turma, plano, contrato e situação |
| Turma | capacidade, horários, professores e disponibilidade |
| Contrato | status, assinatura, consentimentos e documentos |
| Cobrança | valor, vencimento, pagamento, atraso e reconciliação |
| Plano | periodicidade, valor, desconto e configuração financeira |
| Aula | agenda, presença, reposição e aula experimental |
| Loja | produto, variante, estoque, disponibilidade e venda |

Status e ações devem usar os termos existentes no produto. Evitar criar sinônimos que dificultem a leitura operacional, como alternar entre “aluno”, “cliente” e “beneficiário” sem necessidade contextual.

## 19. Regras para novas interfaces

Antes de criar um novo componente:

1. Verifique se já existe componente equivalente em `packages/ui` ou `apps/web/components/ui`.
2. Procure uma implementação equivalente em `apps/web/features` antes de criar um novo padrão.
3. Reutilize tokens e valores existentes.
4. Não crie novas cores arbitrariamente.
5. Não introduza novos tamanhos de botão sem necessidade documentada.
6. Preserve os padrões de tabela, formulário, modal, seleção e estados.
7. Use variantes e composição em vez de duplicar componentes.
8. Prefira tokens semânticos a valores crus quando houver token disponível.
9. Use `cn()` para combinar classes condicionais.
10. Mantenha regras críticas fora dos componentes visuais.
11. Considere mobile, teclado, foco, loading, erro, vazio e disabled.
12. Valide o impacto em fluxos de matrícula, contrato, cobrança, portal e reconciliação quando a tela tocar esses domínios.
13. Novos padrões recorrentes devem ser incorporados a este Design System.

## 20. Processo de evolução

Uma alteração visual recorrente deve seguir este processo:

1. identificar o problema de interface;
2. procurar componentes e valores já existentes;
3. confirmar se a necessidade é local ou sistêmica;
4. definir a menor mudança segura;
5. atualizar o componente compartilhado, quando aplicável;
6. atualizar este documento se a decisão se tornar um padrão;
7. verificar tema escuro, responsividade e acessibilidade;
8. testar visualmente os fluxos afetados;
9. registrar divergências legadas que ainda não puderem ser corrigidas.

O documento deve registrar decisões estáveis, não toda exceção local. Uma exceção só deve ser documentada quando for intencional, recorrente ou necessária para um contexto específico do domínio.

## 21. Checklist de revisão visual

Antes de concluir uma nova tela ou componente:

- [ ] A tela usa a estrutura correta de página, detalhe, modal ou tabela?
- [ ] A largura, o padding e os gaps seguem a escala existente?
- [ ] Cores e estados usam tokens ou valores já existentes?
- [ ] O componente equivalente foi reutilizado?
- [ ] A hierarquia tipográfica está clara?
- [ ] O estado ativo, inativo, disabled, loading, vazio e erro foi tratado?
- [ ] A interface funciona em mobile e desktop?
- [ ] A navegação por teclado e o foco foram verificados?
- [ ] Os dados financeiros e acadêmicos permanecem claros e não ambíguos?
- [ ] A mudança preserva isolamento e não altera regras de domínio indevidamente?
- [ ] Testes relacionados foram adicionados ou executados?
- [ ] O Design System precisa ser atualizado com este novo padrão?

## 22. Boas práticas técnicas de referência

As decisões de organização deste documento seguem práticas compatíveis com a implementação atual:

- concentrar tokens de cor, espaçamento, tipografia e breakpoints na configuração de tema;
- preferir nomes semânticos para cores e estados;
- usar primitivas acessíveis e componentes compostos;
- usar variantes explícitas para diferenças reais de componente;
- combinar classes com `cn()` em vez de espalhar concatenações frágeis;
- manter componentes de feature compostos a partir de primitivas compartilhadas;
- preferir o token semântico à cor bruta para facilitar tema escuro e evolução.

Referências técnicas:

- [Tailwind CSS — Theme configuration](https://v3.tailwindcss.com/docs/theme)
- [Tailwind CSS — Configuration](https://v3.tailwindcss.com/docs/configuration)
- [shadcn/ui — Styling rules](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/rules/styling.md)
- [shadcn/ui — Customization](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/customization.md)

## 23. Nota sobre o estado atual

Este documento consolida os padrões visuais observados nos prints fornecidos e os valores encontrados na implementação da Alusa. O código ainda possui variações legadas, especialmente em:

- `brand-accent` versus `brand.accent`;
- cores claras escritas diretamente em classes Tailwind;
- botão genérico em `packages/ui` usando azul `#2563eb`;
- diferentes raios entre telas antigas e componentes recentes;
- componentes genéricos com tokens diferentes de componentes específicos de domínio.

Essas variações não devem ser apagadas ou normalizadas automaticamente. A migração deve ser incremental, validada visualmente e acompanhada por testes para não quebrar os fluxos existentes.

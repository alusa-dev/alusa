---
title: "Documento tecnico - Assentos agrupados e corredores inteligentes na Alusa"
subtitle: "Especificacao de arquitetura, algoritmos, cenarios e boas praticas para editor de mapas"
author: "Projeto Alusa"
date: "2026-05-22"
---

**Projeto:** Alusa - ERP Educacional multi-tenant  
**Modulo sugerido:** editor de mapas / layouts de salas, eventos, auditórios e ambientes educacionais  
**Stack alvo:** TypeScript, React 18, Next.js 14, Konva/react-konva, Prisma, Zod, Vitest, Playwright, pnpm workspaces  
**Versao:** 1.0  
**Data:** 2026-05-22

---

## Sumario

1. Objetivo do documento  
2. Principios fundamentais  
3. Separacao recomendada entre UI, controle e dominio  
4. Modelo de dados recomendado  
5. Criacao correta dos assentos  
6. Sistema de coordenadas e transformacoes  
7. Corredores inteligentes  
8. Colisao, indice espacial e performance  
9. Reflow dos assentos  
10. Uniao de corredores e formas compostas  
11. Cenarios de resize de corredor por uma aresta  
12. Corredores nas laterais internas e bordas do SeatGroup  
13. Rotacao de assentos e corredores juntos  
14. Dimensionamento de selecao multipla  
15. Konva: como evitar bugs de scale, stroke e transform  
16. Snapping, guias e responsividade  
17. Operacoes do mapa  
18. Todos os principais cenarios e comportamento esperado  
19. Validacoes e invariantes  
20. Persistencia e isolamento multi-tenant  
21. Estado local, historico e undo/redo  
22. UI e experiencia do usuario  
23. Renderizacao com Konva  
24. Algoritmo completo de impacto de corredores  
25. Estrategias para corredores diagonais e rotacionados  
26. Testes com Vitest  
27. Testes E2E com Playwright  
28. Erros comuns e como evitar  
29. Plano de implementacao recomendado  
30. Checklist final de qualidade  
31. Referencias tecnicas consultadas  
32. Decisao arquitetural final

---

## 1. Objetivo do documento

Este documento consolida a arquitetura, as boas praticas, os modelos de dados, os calculos, os algoritmos e os cenários de teste para implementar, de forma profissional e responsiva, uma ferramenta de **assentos agrupados** e **corredores inteligentes** no editor de mapas da Alusa.

O objetivo é permitir que uma escola, curso, instituição ou operação educacional desenhe ambientes com assentos organizados em fileiras e colunas, aplique corredores internos, laterais, inferiores, superiores, diagonais ou compostos, e consiga mover, rotacionar e redimensionar os objetos sem quebrar a numeração, o espaçamento, a estrutura das fileiras ou a responsividade visual.

A regra central é:

> O canvas nao decide layout. React nao decide layout. Konva nao decide layout. A engine pura decide layout. O canvas apenas renderiza e captura interacoes.

---

## 2. Principios fundamentais

### 2.1. Assentos devem nascer em um grupo logico parametrico

Quando o usuario cria uma grade de assentos, por exemplo 10 colunas por 8 fileiras, esses assentos devem nascer dentro de um `SeatGroup`.

Esse grupo nao deve ser apenas um `<Group>` visual do Konva. Ele deve ser uma entidade logica com regras proprias:

- quantidade de fileiras;
- quantidade de colunas;
- largura e altura do assento;
- espacamento horizontal e vertical;
- padding externo;
- regra de numeracao;
- direcao de leitura;
- origem/ancora;
- rotacao;
- transformacao;
- status de edicao;
- impactos de corredores.

Cada assento, ao mesmo tempo, precisa continuar tendo identidade individual. Isso e importante para futuras funcionalidades como reserva, venda, check-in, bloqueio, ocupacao, acessibilidade, status financeiro, mapa de sala e relatorios.

### 2.2. Assentos nao devem perder identidade ao serem reorganizados

A numeracao nunca deve ser recalculada a partir da posicao visual atual. Ela deve ser derivada de `rowIndex`, `columnIndex` e da configuracao de numeracao.

Errado:

```ts
const seatsSortedByPosition = seats.sort((a, b) => a.y - b.y || a.x - b.x);
const label = generateLabelFromVisualOrder(seatsSortedByPosition);
```

Certo:

```ts
const label = getSeatLabel({
  rowIndex: seat.rowIndex,
  columnIndex: seat.columnIndex,
  numbering: seatGroup.numbering,
});
```

Isso garante que o assento `A1` continue sendo `A1` mesmo quando um corredor for criado, movido, esticado, rotacionado ou unido a outro corredor.

### 2.3. Corredor inteligente nao deve destruir a estrutura do SeatGroup

O corredor deve gerar um impacto recalculavel, nao alterar permanentemente as posicoes-base dos assentos.

Modelo correto:

```txt
SeatGroup config
+ Seat identities
+ Corridor geometries
+ CorridorImpactMap
= posicao visual final
```

Modelo perigoso:

```txt
Arrastou corredor
-> alterou x/y real de varios assentos
-> salvou como nova verdade
-> perdeu estrutura, gaps e numeracao
```

### 2.4. Transformacoes devem usar snapshots

Durante drag, resize e rotacao, salve um snapshot do estado inicial e calcule o novo estado a partir dele. Nao aplique deltas acumulados sobre deltas anteriores.

Correto:

```ts
nextX = snapshot.x + deltaX;
nextY = snapshot.y + deltaY;
```

Perigoso:

```ts
object.x += deltaX;
object.y += deltaY;
```

O segundo modelo acumula erro, especialmente com zoom, rotacao, transformacao pai-filho e snapping.

### 2.5. A engine precisa ser deterministica

A mesma entrada deve gerar sempre a mesma saida.

```ts
const result1 = applyMapOperation(input);
const result2 = applyMapOperation(input);
expect(result1).toEqual(result2);
```

Isso facilita testes, undo/redo, colaboracao futura, persistencia, auditoria e debug.

---

## 3. Separacao recomendada entre UI, controle e dominio

A ferramenta deve ser dividida em camadas:

```txt
apps/web
  UI React/Konva
  hooks de interacao
  estado local do editor
  chamadas API

packages/domain ou packages/lib
  engine pura de mapa
  geometria
  reflow
  colisoes
  transformacoes
  numeracao

packages/database
  persistencia com Prisma

API Routes / Route Handlers
  validacao Zod
  isolamento por contaId
  autorizacao
  persistencia
```

### 3.1. Onde colocar cada responsabilidade

| Responsabilidade | Local recomendado | Observacao |
|---|---|---|
| Renderizar assentos | `apps/web/features/maps/components` | Sem regra pesada de layout |
| Capturar drag/resize/rotate | `apps/web/features/maps/hooks` | Converte evento em operacao |
| Calcular colisoes | `packages/domain/src/map-layout/geometry` | Funcoes puras |
| Calcular reflow | `packages/domain/src/map-layout/corridors` | Funcoes puras |
| Gerar labels | `packages/domain/src/map-layout/seat-groups` | Funcoes puras |
| Validar inputs | `packages/shared` ou `packages/lib` | Zod schemas compartilhados |
| Persistir mapa | `apps/web/api` + `packages/database` | Sempre com `contaId` |
| Testar engine | `packages/domain` | Vitest |
| Testar canvas | `apps/web` | Playwright |

### 3.2. Estrutura de workspace sugerida

```txt
packages/domain/src/map-layout/
  geometry/
    point.ts
    vector.ts
    rect.ts
    bounds.ts
    polygon.ts
    matrix.ts
    transform.ts
    collision.ts
    spatial-index.ts

  seat-groups/
    create-seat-group.ts
    derive-seats.ts
    label-seats.ts
    resize-seat-group.ts
    rotate-seat-group.ts
    apply-seat-overrides.ts
    validate-seat-group.ts

  corridors/
    create-corridor.ts
    normalize-corridor.ts
    corridor-to-polygon.ts
    merge-corridors.ts
    detect-corridor-impact.ts
    apply-corridor-reflow.ts
    resolve-corridor-padding.ts
    classify-corridor-axis.ts

  operations/
    apply-map-operation.ts
    move-selection.ts
    resize-selection.ts
    rotate-selection.ts
    drag-corridor-edge.ts
    duplicate-selection.ts
    delete-selection.ts

  state/
    map-layout-state.ts
    map-layout-result.ts
    map-layout-warning.ts

apps/web/features/maps/
  components/
    MapCanvas.tsx
    MapStage.tsx
    SeatGroupShape.tsx
    SeatShape.tsx
    SmartCorridorShape.tsx
    SelectionTransformer.tsx
    SnapGuidesOverlay.tsx
    MapPropertiesPanel.tsx

  hooks/
    useMapEditorState.ts
    useMapSelection.ts
    useMapOperations.ts
    useMapHistory.ts
    useKonvaTransformer.ts
    useMapSnapping.ts

  lib/
    konva-node-normalizers.ts
    pointer-to-world.ts
    canvas-layer-policy.ts
```

---

## 4. Modelo de dados recomendado

### 4.1. Tipos base

```ts
export type ID = string;

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Transform2D = {
  x: number;
  y: number;
  rotation: number; // radians ou degrees, mas escolha um padrao
  scaleX: number;
  scaleY: number;
};
```

Recomendacao: internamente use **radianos** para calculo geometrico e converta para graus apenas na UI, se necessario.

### 4.2. SeatGroup

```ts
export type SeatGroup = {
  id: ID;
  contaId: ID;

  name?: string;

  x: number;
  y: number;
  rotation: number;

  rows: number;
  columns: number;

  seatWidth: number;
  seatHeight: number;
  gapX: number;
  gapY: number;

  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;

  numbering: SeatNumberingConfig;

  behavior: SeatGroupBehavior;

  locked?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
```

### 4.3. SeatNumberingConfig

```ts
export type SeatNumberingConfig = {
  mode: 'ROW_MAJOR' | 'COLUMN_MAJOR';
  rowLabelStart: string; // 'A'
  seatNumberStart: number; // 1
  rowDirection: 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';
  columnDirection: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  rowLabelFormat: 'A' | 'AA' | '01' | 'ROMAN';
  separator?: string; // '', '-', '.'
};
```

### 4.4. Seat

Existem duas abordagens:

1. **Assentos persistidos individualmente:** util quando cada assento tem status, venda, reserva, historico e regras proprias.
2. **Assentos derivados:** util para mapas simples, onde a grade e fonte de verdade e os assentos sao calculados sob demanda.

Para a Alusa, a recomendacao e um modelo hibrido: persistir identidade e status dos assentos, mas derivar posicao visual a partir do grupo.

```ts
export type Seat = {
  id: ID;
  contaId: ID;
  groupId: ID;

  rowIndex: number;
  columnIndex: number;

  label: string;

  status:
    | 'AVAILABLE'
    | 'RESERVED'
    | 'OCCUPIED'
    | 'BLOCKED'
    | 'HIDDEN_BY_CORRIDOR'
    | 'REMOVED';

  manualOverride?: SeatManualOverride;
};

export type SeatManualOverride = {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  labelOverride?: string;
};
```

### 4.5. SmartCorridor

```ts
export type SmartCorridor = {
  id: ID;
  contaId: ID;

  name?: string;

  kind: 'SMART_CORRIDOR';
  geometryKind: 'RECT' | 'POLYLINE' | 'POLYGON_COMPOSITE';

  x: number;
  y: number;
  rotation: number;

  width: number;
  height: number;

  thickness: number;

  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  behavior: CorridorBehavior;

  locked?: boolean;
};

export type CorridorBehavior = {
  impactMode: 'BLOCK_SEATS' | 'HIDE_SEATS' | 'PUSH_SEATS' | 'SPLIT_VISUAL_BLOCKS';
  mergeOnIntersect: boolean;
  allowRotation: boolean;
  minThickness: number;
  minDistanceFromSeat: number;
  snapToSeatGaps: boolean;
  snapToSeatGroupInnerEdges: boolean;
};
```

### 4.6. CorridorImpact

```ts
export type CorridorImpact = {
  id: ID;
  contaId: ID;

  corridorIds: ID[];
  groupId: ID;

  hiddenSeatIds: ID[];
  blockedSeatIds: ID[];

  offsetsBySeatId: Record<ID, { dx: number; dy: number }>;

  visualBlocks?: VisualSeatBlock[];
};

export type VisualSeatBlock = {
  id: ID;
  groupId: ID;
  rowRange: [number, number];
  columnRange: [number, number];
  offset: { dx: number; dy: number };
};
```

---

## 5. Criacao correta dos assentos

### 5.1. Fluxo de criacao

Quando o usuario adiciona um grupo de assentos:

```txt
1. UI coleta rows, columns, seatWidth, seatHeight, gapX, gapY, numbering.
2. Zod valida limites e tipos.
3. Engine cria SeatGroup.
4. Engine deriva Seat identities.
5. UI renderiza preview.
6. Usuario confirma.
7. API persiste com contaId.
```

### 5.2. Schema Zod sugerido

```ts
import { z } from 'zod';

export const createSeatGroupSchema = z.object({
  contaId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  rows: z.number().int().min(1).max(200),
  columns: z.number().int().min(1).max(300),
  seatWidth: z.number().min(4).max(200),
  seatHeight: z.number().min(4).max(200),
  gapX: z.number().min(0).max(200),
  gapY: z.number().min(0).max(200),
  paddingTop: z.number().min(0).max(500).default(0),
  paddingRight: z.number().min(0).max(500).default(0),
  paddingBottom: z.number().min(0).max(500).default(0),
  paddingLeft: z.number().min(0).max(500).default(0),
  numbering: z.object({
    mode: z.enum(['ROW_MAJOR', 'COLUMN_MAJOR']).default('ROW_MAJOR'),
    rowLabelStart: z.string().min(1).default('A'),
    seatNumberStart: z.number().int().min(1).default(1),
    rowDirection: z.enum(['TOP_TO_BOTTOM', 'BOTTOM_TO_TOP']).default('TOP_TO_BOTTOM'),
    columnDirection: z.enum(['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT']).default('LEFT_TO_RIGHT'),
    rowLabelFormat: z.enum(['A', 'AA', '01', 'ROMAN']).default('A'),
    separator: z.string().max(3).default(''),
  }),
});
```

### 5.3. Calculo da posicao local do assento

```ts
export function getSeatLocalPosition(input: {
  rowIndex: number;
  columnIndex: number;
  group: SeatGroup;
}): Point {
  const { rowIndex, columnIndex, group } = input;

  return {
    x: group.paddingLeft + columnIndex * (group.seatWidth + group.gapX),
    y: group.paddingTop + rowIndex * (group.seatHeight + group.gapY),
  };
}
```

### 5.4. Tamanho total do SeatGroup

```ts
export function getSeatGroupLocalSize(group: SeatGroup): Size {
  const seatsWidth =
    group.columns * group.seatWidth + Math.max(0, group.columns - 1) * group.gapX;

  const seatsHeight =
    group.rows * group.seatHeight + Math.max(0, group.rows - 1) * group.gapY;

  return {
    width: group.paddingLeft + seatsWidth + group.paddingRight,
    height: group.paddingTop + seatsHeight + group.paddingBottom,
  };
}
```

### 5.5. Geracao de labels

```ts
export function getSeatLabel(input: {
  rowIndex: number;
  columnIndex: number;
  numbering: SeatNumberingConfig;
}): string {
  const { rowIndex, columnIndex, numbering } = input;

  const normalizedRowIndex =
    numbering.rowDirection === 'TOP_TO_BOTTOM'
      ? rowIndex
      : -rowIndex;

  const normalizedColumnIndex =
    numbering.columnDirection === 'LEFT_TO_RIGHT'
      ? columnIndex
      : -columnIndex;

  const rowLabel = formatRowLabel({
    start: numbering.rowLabelStart,
    offset: normalizedRowIndex,
    format: numbering.rowLabelFormat,
  });

  const number = numbering.seatNumberStart + normalizedColumnIndex;

  if (numbering.mode === 'ROW_MAJOR') {
    return `${rowLabel}${numbering.separator ?? ''}${number}`;
  }

  return `${number}${numbering.separator ?? ''}${rowLabel}`;
}
```

Importante: se `columnDirection` for `RIGHT_TO_LEFT`, nao use numero negativo. Na implementacao final, primeiro transforme a ordem em indice visual:

```ts
const visualColumnIndex =
  numbering.columnDirection === 'LEFT_TO_RIGHT'
    ? columnIndex
    : group.columns - 1 - columnIndex;
```

O exemplo anterior mostra a ideia, mas a versao final deve usar o total de colunas/fileiras para evitar numeros negativos.

---

## 6. Sistema de coordenadas e transformacoes

### 6.1. Local space e world space

Cada objeto deve ter um espaco local e um espaco global.

```txt
Assento local
-> transformacao do SeatGroup
-> world space

Corredor local
-> transformacao do corredor
-> world space

Selecao multipla
-> common bounds
-> transformacao composta
```

Para evitar bugs, toda colisao deve acontecer em world space.

### 6.2. Matriz 2D

```ts
export type Matrix2D = [
  number, number,
  number, number,
  number, number
];

export function multiplyPoint(matrix: Matrix2D, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;

  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}
```

### 6.3. Criar matriz de transformacao

```ts
export function createMatrix(transform: Transform2D): Matrix2D {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);

  return [
    cos * transform.scaleX,
    sin * transform.scaleX,
    -sin * transform.scaleY,
    cos * transform.scaleY,
    transform.x,
    transform.y,
  ];
}
```

### 6.4. Transformar retangulo em poligono

```ts
export function rectToPolygon(bounds: Bounds, matrix: Matrix2D): Point[] {
  const points: Point[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];

  return points.map((point) => multiplyPoint(matrix, point));
}
```

### 6.5. Conversao de delta global para delta local

Quando um objeto esta dentro de um grupo rotacionado, mover 10px para direita em world space nao significa somar `x += 10` no local space. E preciso converter o delta pelo inverso da rotacao do pai.

```ts
export function worldDeltaToLocalDelta(delta: Point, parentRotation: number): Point {
  const cos = Math.cos(-parentRotation);
  const sin = Math.sin(-parentRotation);

  return {
    x: delta.x * cos - delta.y * sin,
    y: delta.x * sin + delta.y * cos,
  };
}
```

Esse ponto e essencial para rotacao conjunta de assentos e corredores.

---

## 7. Corredores inteligentes

### 7.1. Conceito

O corredor e uma geometria de exclusao, separacao e organizacao visual. Ele pode:

- bloquear assentos;
- ocultar assentos;
- empurrar assentos;
- dividir visualmente um grupo em blocos;
- se unir a outros corredores;
- formar L, T, cruz, U ou composicoes internas;
- respeitar padding interno/externo;
- respeitar espessura minima;
- preservar gaps.

### 7.2. Espessura minima

Nunca permita corredor com espessura abaixo de um minimo. Corredores com 1px geram colisoes estranhas, flicker visual e reflow imprevisivel.

```ts
export const MIN_CORRIDOR_THICKNESS = 8;
export const MIN_DISTANCE_FROM_SEAT = 2;
export const MIN_SEAT_GAP_X = 4;
export const MIN_SEAT_GAP_Y = 4;
```

```ts
export function normalizeCorridor(corridor: SmartCorridor): SmartCorridor {
  const minThickness = corridor.behavior.minThickness ?? MIN_CORRIDOR_THICKNESS;

  return {
    ...corridor,
    width: Math.max(corridor.width, minThickness),
    height: Math.max(corridor.height, minThickness),
    thickness: Math.max(corridor.thickness, minThickness),
  };
}
```

### 7.3. Padding do corredor

O padding do corredor deve ser tratado como uma zona de seguranca, nao apenas estilo visual.

```txt
corredor visual
+ padding de impacto
= area de exclusao usada na engine
```

```ts
export function expandBoundsByPadding(
  bounds: Bounds,
  padding: SmartCorridor['padding']
): Bounds {
  return {
    x: bounds.x - padding.left,
    y: bounds.y - padding.top,
    width: bounds.width + padding.left + padding.right,
    height: bounds.height + padding.top + padding.bottom,
  };
}
```

Cenario aplicado: se o usuario posiciona um corredor na lateral interna do grupo de assentos e aumenta o padding externo do corredor, os assentos devem se afastar da area de impacto expandida.

### 7.4. Corredor como poligono

Mesmo um corredor retangular deve ser convertido para poligono antes de colidir com assentos. Isso evita bugs com rotacao.

```ts
export function corridorToPolygon(corridor: SmartCorridor): Point[] {
  const normalized = normalizeCorridor(corridor);

  const localBounds = expandBoundsByPadding(
    { x: 0, y: 0, width: normalized.width, height: normalized.height },
    normalized.padding
  );

  const matrix = createMatrix({
    x: normalized.x,
    y: normalized.y,
    rotation: normalized.rotation,
    scaleX: 1,
    scaleY: 1,
  });

  return rectToPolygon(localBounds, matrix);
}
```

---

## 8. Colisao, indice espacial e performance

### 8.1. Nao varrer todos os assentos sempre

Em mapas grandes, um ambiente pode ter milhares de assentos. Durante resize/drag do corredor, varrer todos os assentos a cada frame pode gerar travamentos.

Use um indice espacial, como RBush, para buscar apenas assentos proximos ao bounds do corredor.

### 8.2. Item do indice espacial

```ts
export type SpatialItem = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: ID;
  kind: 'SEAT' | 'CORRIDOR' | 'OBJECT';
};
```

### 8.3. Criar indice

```ts
import RBush from 'rbush';

export function buildSpatialIndex(items: SpatialItem[]): RBush<SpatialItem> {
  const index = new RBush<SpatialItem>();
  index.load(items);
  return index;
}
```

### 8.4. Buscar candidatos

```ts
export function findCandidateSeats(input: {
  index: RBush<SpatialItem>;
  corridorBounds: Bounds;
}): SpatialItem[] {
  const { x, y, width, height } = input.corridorBounds;

  return input.index.search({
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
    id: 'query',
    kind: 'OBJECT',
  });
}
```

### 8.5. Filtro fino

O indice espacial retorna candidatos por bounding box. Depois, aplique colisao real poligono versus poligono.

```ts
export function detectCorridorSeatCollisions(input: {
  corridorPolygon: Point[];
  candidateSeats: DerivedSeat[];
}): DerivedSeat[] {
  return input.candidateSeats.filter((seat) =>
    polygonsIntersect(input.corridorPolygon, seat.worldPolygon)
  );
}
```

---

## 9. Reflow dos assentos

### 9.1. Modos de impacto

A Alusa pode suportar diferentes modos de comportamento:

| Modo | Comportamento | Uso recomendado |
|---|---|---|
| `HIDE_SEATS` | assentos atingidos somem visualmente | mapa realista, corredor consome espaco |
| `BLOCK_SEATS` | assentos atingidos ficam bloqueados | quando precisa manter posicao mas impedir uso |
| `PUSH_SEATS` | assentos sao deslocados | editor responsivo/dinamico |
| `SPLIT_VISUAL_BLOCKS` | grupo continua unico, mas visual divide em blocos | melhor equilibrio para Alusa |

Recomendacao: implementar primeiro `HIDE_SEATS` e `SPLIT_VISUAL_BLOCKS`. Depois adicionar `PUSH_SEATS` com mais regras.

### 9.2. Reflow por eixo dominante

Para corredores retangulares ou quase retangulares, classifique o eixo dominante:

```ts
export function classifyCorridorAxis(corridor: SmartCorridor): 'HORIZONTAL' | 'VERTICAL' | 'DIAGONAL' {
  const ratio = corridor.width / corridor.height;

  if (ratio >= 1.5) return 'HORIZONTAL';
  if (ratio <= 1 / 1.5) return 'VERTICAL';
  return 'DIAGONAL';
}
```

### 9.3. Corredor horizontal sobre fileiras

Cenario: o usuario arrasta um corredor horizontal sobre o meio do grupo.

Resultado esperado:

```txt
Antes:
A1 A2 A3 A4
B1 B2 B3 B4
C1 C2 C3 C4
D1 D2 D3 D4

Depois:
A1 A2 A3 A4
B1 B2 B3 B4
======== corredor ========
C1 C2 C3 C4
D1 D2 D3 D4
```

A numeracao nao muda. As fileiras abaixo recebem offset vertical.

### 9.4. Corredor vertical sobre colunas

```txt
Antes:
A1 A2 A3 A4 A5 A6
B1 B2 B3 B4 B5 B6

Depois:
A1 A2 A3 | corredor | A4 A5 A6
B1 B2 B3 | corredor | B4 B5 B6
```

A fileira permanece a mesma. A coluna visual e dividida, mas `columnIndex` nao muda.

### 9.5. Calculo de offset por corredor vertical

```ts
export function calculateVerticalCorridorOffsets(input: {
  seats: DerivedSeat[];
  corridorBounds: Bounds;
  corridorWidthWithPadding: number;
  minDistance: number;
}): Record<ID, { dx: number; dy: number }> {
  const result: Record<ID, { dx: number; dy: number }> = {};

  const corridorCenterX = input.corridorBounds.x + input.corridorBounds.width / 2;
  const shift = input.corridorWidthWithPadding + input.minDistance;

  for (const seat of input.seats) {
    const seatCenterX = seat.worldBounds.x + seat.worldBounds.width / 2;

    if (seatCenterX > corridorCenterX) {
      result[seat.id] = { dx: shift, dy: 0 };
    } else {
      result[seat.id] = { dx: 0, dy: 0 };
    }
  }

  return result;
}
```

### 9.6. Calculo de offset por corredor horizontal

```ts
export function calculateHorizontalCorridorOffsets(input: {
  seats: DerivedSeat[];
  corridorBounds: Bounds;
  corridorHeightWithPadding: number;
  minDistance: number;
}): Record<ID, { dx: number; dy: number }> {
  const result: Record<ID, { dx: number; dy: number }> = {};

  const corridorCenterY = input.corridorBounds.y + input.corridorBounds.height / 2;
  const shift = input.corridorHeightWithPadding + input.minDistance;

  for (const seat of input.seats) {
    const seatCenterY = seat.worldBounds.y + seat.worldBounds.height / 2;

    if (seatCenterY > corridorCenterY) {
      result[seat.id] = { dx: 0, dy: shift };
    } else {
      result[seat.id] = { dx: 0, dy: 0 };
    }
  }

  return result;
}
```

### 9.7. Importante sobre offsets

Os offsets devem ser derivados, nao salvos como nova posicao-base.

```ts
const visualPosition = {
  x: baseWorldPosition.x + corridorOffset.dx + manualOverride.dx,
  y: baseWorldPosition.y + corridorOffset.dy + manualOverride.dy,
};
```

---

## 10. Uniao de corredores e formas compostas

### 10.1. Cenarios

A engine precisa tratar:

- corredor horizontal;
- corredor vertical;
- corredor em L;
- corredor em T;
- corredor em +;
- corredor em U;
- corredores sobrepostos;
- corredores encostados por borda;
- corredores encostados por ponta;
- corredor rotacionado cruzando outro;
- corredor parcialmente fora do grupo;
- corredor exatamente dentro de um gap.

### 10.2. Regra profissional

Antes de calcular impacto nos assentos:

```txt
1. normalizar corredores;
2. converter cada corredor em poligono;
3. detectar corredores que intersectam ou encostam;
4. unir geometrias;
5. gerar areas de exclusao compostas;
6. aplicar impacto uma unica vez.
```

Isso evita o bug de deslocar duas vezes o mesmo assento.

### 10.3. Exemplo de uniao conceitual

```ts
import polygonClipping from 'polygon-clipping';

export function mergeCorridorPolygons(polygons: MultiPolygon[]): MultiPolygon {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons[0];

  return polygonClipping.union(...polygons);
}
```

### 10.4. Corredor em L

```txt
horizontal + vertical com interseccao na ponta
= L composto
```

Comportamento esperado:

- visualmente vira um unico corredor;
- engine trata como uma unica area de exclusao;
- assentos proximo ao canto nao devem sobrepor o miolo do L;
- offsets nao devem duplicar;
- ao mover o L inteiro, todos os segmentos preservam posicao relativa.

### 10.5. Corredor em +

```txt
horizontal atravessando vertical
= + composto
```

Comportamento esperado:

- uniao geometrica antes do reflow;
- assentos nos quatro quadrantes podem formar blocos visuais;
- labels continuam estaveis;
- gaps ao redor da cruz respeitam padding e distancia minima;
- se o usuario seleciona a cruz inteira, ela move como uma geometria composta.

### 10.6. Corredor em T

```txt
horizontal encosta no meio do vertical
= T composto
```

Comportamento esperado:

- a ponta do T nao cria sobreposicao residual;
- assentos encostados no encontro precisam respeitar area de seguranca;
- se redimensionar a haste vertical, o topo horizontal nao deve escalar acidentalmente, a menos que ambos estejam selecionados.

---

## 11. Cenarios de resize de corredor por uma aresta

### 11.1. Problema

O usuario pode selecionar apenas uma aresta do corredor e esticar sobre os assentos. Exemplo: corredor vertical no meio do grupo, usuario arrasta a aresta direita para aumentar a largura.

Resultado esperado:

```txt
1. corredor aumenta apenas para o lado da aresta arrastada;
2. a ancora oposta permanece fixa;
3. assentos atingidos sao reorganizados;
4. padding do corredor e considerado;
5. SeatGroup nao perde numeracao;
6. scaleX/scaleY do Konva volta para 1 apos transformEnd.
```

### 11.2. Modelo de anchors

```ts
export type ResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';
```

### 11.3. Algoritmo para resize por aresta

```ts
export function resizeBoundsByHandle(input: {
  original: Bounds;
  handle: ResizeHandle;
  delta: Point;
  minWidth: number;
  minHeight: number;
}): Bounds {
  const { original, handle, delta, minWidth, minHeight } = input;
  let { x, y, width, height } = original;

  if (handle.includes('right')) {
    width = Math.max(minWidth, width + delta.x);
  }

  if (handle.includes('left')) {
    const nextWidth = Math.max(minWidth, width - delta.x);
    x = x + (width - nextWidth);
    width = nextWidth;
  }

  if (handle.includes('bottom')) {
    height = Math.max(minHeight, height + delta.y);
  }

  if (handle.includes('top')) {
    const nextHeight = Math.max(minHeight, height - delta.y);
    y = y + (height - nextHeight);
    height = nextHeight;
  }

  return { x, y, width, height };
}
```

### 11.4. Resize de corredor rotacionado por aresta

Se o corredor estiver rotacionado, o delta do mouse vem em world space. Antes de alterar o bounds local, converta o delta para o local space do corredor.

```ts
export function resizeRotatedCorridorByHandle(input: {
  corridor: SmartCorridor;
  handle: ResizeHandle;
  worldDelta: Point;
}): SmartCorridor {
  const localDelta = worldDeltaToLocalDelta(input.worldDelta, input.corridor.rotation);

  const nextBounds = resizeBoundsByHandle({
    original: {
      x: input.corridor.x,
      y: input.corridor.y,
      width: input.corridor.width,
      height: input.corridor.height,
    },
    handle: input.handle,
    delta: localDelta,
    minWidth: input.corridor.behavior.minThickness,
    minHeight: input.corridor.behavior.minThickness,
  });

  return {
    ...input.corridor,
    x: nextBounds.x,
    y: nextBounds.y,
    width: nextBounds.width,
    height: nextBounds.height,
  };
}
```

### 11.5. Reflow apos resize por aresta

No `transform` ou `dragMove`, gere apenas preview. No `transformEnd`, normalize e aplique a engine.

```ts
export function onCorridorTransformEnd(input: {
  state: MapLayoutState;
  corridorId: ID;
  nextBounds: Bounds;
  handle: ResizeHandle;
}): MapLayoutResult {
  return applyMapOperation({
    state: input.state,
    operation: {
      type: 'RESIZE_CORRIDOR_EDGE',
      corridorId: input.corridorId,
      nextBounds: input.nextBounds,
      handle: input.handle,
    },
  });
}
```

---

## 12. Corredores nas laterais internas e bordas do SeatGroup

### 12.1. Cenario: corredor na lateral esquerda interna

O usuario coloca um corredor vertical dentro do SeatGroup, encostado na lateral esquerda interna.

Resultado esperado:

```txt
| corredor | A1 A2 A3 A4
| corredor | B1 B2 B3 B4
```

Regras:

- corredor nao deve sair do grupo se estiver com snap interno ativo;
- assentos devem deslocar para direita ou respeitar padding;
- `paddingLeft` visual do grupo pode aumentar se o corredor for configurado como padding estrutural;
- labels nao mudam.

### 12.2. Cenario: corredor na lateral direita interna

```txt
A1 A2 A3 A4 | corredor |
B1 B2 B3 B4 | corredor |
```

Regras:

- se estiver fora dos assentos, nao precisa esconder assentos;
- se invadir a ultima coluna, aplica impacto;
- padding do corredor aumenta distancia da ultima coluna;
- se o corredor for anexado a borda, pode virar `internalEdgeCorridor`.

### 12.3. Cenario: corredor na borda superior interna

```txt
======== corredor ========
A1 A2 A3 A4
B1 B2 B3 B4
```

Regras:

- assentos deslocam para baixo ou `paddingTop` aumenta;
- se o usuario esticar a espessura do corredor, o primeiro bloco de fileiras se afasta;
- a origem da numeracao continua a mesma.

### 12.4. Cenario: corredor na borda inferior interna

```txt
A1 A2 A3 A4
B1 B2 B3 B4
======== corredor ========
```

Regras:

- se o corredor nao colide com assentos, nao desloca;
- se aumentar altura e invadir ultima fileira, bloqueia/oculta/desloca;
- padding inferior deve afetar bounds total do grupo se configurado como estrutural.

### 12.5. Corredor como padding estrutural do SeatGroup

Quando um corredor fica colado a uma borda interna, a Alusa pode permitir uma propriedade:

```ts
export type CorridorAttachment =
  | { type: 'FREE' }
  | { type: 'SEAT_GROUP_INNER_EDGE'; groupId: ID; edge: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' };
```

Se `attachment.type === 'SEAT_GROUP_INNER_EDGE'`, o corredor pode influenciar o padding do grupo:

```ts
export function applyAttachedCorridorPadding(input: {
  group: SeatGroup;
  corridor: SmartCorridor;
  attachment: CorridorAttachment;
}): SeatGroup {
  if (input.attachment.type !== 'SEAT_GROUP_INNER_EDGE') return input.group;

  const distance = input.corridor.thickness + resolveCorridorPaddingTotal(input.corridor);

  switch (input.attachment.edge) {
    case 'TOP':
      return { ...input.group, paddingTop: Math.max(input.group.paddingTop, distance) };
    case 'RIGHT':
      return { ...input.group, paddingRight: Math.max(input.group.paddingRight, distance) };
    case 'BOTTOM':
      return { ...input.group, paddingBottom: Math.max(input.group.paddingBottom, distance) };
    case 'LEFT':
      return { ...input.group, paddingLeft: Math.max(input.group.paddingLeft, distance) };
  }
}
```

### 12.6. Snap em bordas internas

Ao arrastar corredor perto das bordas internas do SeatGroup, use snap com threshold em pixels de tela.

```ts
export function getSnapThreshold(input: { zoom: number }): number {
  return 8 / input.zoom;
}
```

Isso faz o snap parecer consistente em qualquer nivel de zoom.

---

## 13. Rotacao de assentos e corredores juntos

### 13.1. Cenario

Usuario seleciona um SeatGroup e um ou mais corredores e rotaciona tudo junto.

Resultado esperado:

- a posicao relativa entre assentos e corredores e preservada;
- os corredores continuam alinhados visualmente ao grupo;
- o reflow nao embaralha numeracao;
- os objetos orbitam o centro comum da selecao;
- cada objeto tambem atualiza sua propria rotacao;
- nao ha acumulacao de `scaleX/scaleY`;
- apos soltar, a engine recalcula colisoes no novo world space.

### 13.2. Centro comum da selecao

```ts
export function getSelectionCenter(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}
```

### 13.3. Rotacionar ponto ao redor do centro

```ts
export function rotatePointAroundCenter(input: {
  point: Point;
  center: Point;
  angle: number;
}): Point {
  const dx = input.point.x - input.center.x;
  const dy = input.point.y - input.center.y;

  const cos = Math.cos(input.angle);
  const sin = Math.sin(input.angle);

  return {
    x: input.center.x + dx * cos - dy * sin,
    y: input.center.y + dx * sin + dy * cos,
  };
}
```

### 13.4. Rotacionar selecao

```ts
export function rotateSelection(input: {
  objects: MapObject[];
  selectedIds: ID[];
  angleDelta: number;
  snapshot: MapObjectSnapshot[];
}): MapObject[] {
  const selectedSnapshots = input.snapshot.filter((item) =>
    input.selectedIds.includes(item.id)
  );

  const bounds = getObjectsWorldBounds(selectedSnapshots);
  const center = getSelectionCenter(bounds);

  return input.objects.map((object) => {
    const snap = selectedSnapshots.find((item) => item.id === object.id);
    if (!snap) return object;

    const nextPosition = rotatePointAroundCenter({
      point: { x: snap.x, y: snap.y },
      center,
      angle: input.angleDelta,
    });

    return {
      ...object,
      x: nextPosition.x,
      y: nextPosition.y,
      rotation: snap.rotation + input.angleDelta,
    };
  });
}
```

### 13.5. Ponto importante

Durante a rotacao conjunta, nao recalcule labels, nao recrie assentos e nao quebre grupos. Apenas aplique transformacao comum. O reflow completo deve acontecer no fim da operacao.

---

## 14. Dimensionamento de selecao multipla

### 14.1. Cenario

Usuario seleciona:

```txt
SeatGroup + corredores + textos + palco + objetos auxiliares
```

E redimensiona tudo de uma vez.

Resultado esperado:

- todos os objetos preservam proporcao relativa;
- assentos continuam em grade;
- corredores continuam conectados;
- `scaleX/scaleY` nao fica acumulado no Konva;
- labels nao mudam;
- apos soltar, a engine recalcula impactos.

### 14.2. Escala baseada no bounds comum

```ts
export function scalePointFromBounds(input: {
  point: Point;
  from: Bounds;
  to: Bounds;
}): Point {
  const scaleX = input.to.width / input.from.width;
  const scaleY = input.to.height / input.from.height;

  return {
    x: input.to.x + (input.point.x - input.from.x) * scaleX,
    y: input.to.y + (input.point.y - input.from.y) * scaleY,
  };
}
```

### 14.3. Redimensionar SeatGroup

Existem dois modos principais.

#### Modo A: escala geometrica

```ts
export function scaleSeatGroupGeometry(input: {
  group: SeatGroup;
  scaleX: number;
  scaleY: number;
}): SeatGroup {
  return {
    ...input.group,
    seatWidth: input.group.seatWidth * input.scaleX,
    seatHeight: input.group.seatHeight * input.scaleY,
    gapX: input.group.gapX * input.scaleX,
    gapY: input.group.gapY * input.scaleY,
    paddingLeft: input.group.paddingLeft * input.scaleX,
    paddingRight: input.group.paddingRight * input.scaleX,
    paddingTop: input.group.paddingTop * input.scaleY,
    paddingBottom: input.group.paddingBottom * input.scaleY,
  };
}
```

#### Modo B: preservar tamanho dos assentos e ajustar gaps

Esse modo e melhor quando o usuario quer apenas ocupar mais espaco mantendo assentos do mesmo tamanho.

```ts
export function resizeSeatGroupPreservingSeatSize(input: {
  group: SeatGroup;
  nextWidth: number;
  nextHeight: number;
}): SeatGroup {
  const availableWidth =
    input.nextWidth - input.group.paddingLeft - input.group.paddingRight;

  const availableHeight =
    input.nextHeight - input.group.paddingTop - input.group.paddingBottom;

  const totalSeatWidth = input.group.columns * input.group.seatWidth;
  const totalSeatHeight = input.group.rows * input.group.seatHeight;

  const gapX =
    input.group.columns > 1
      ? Math.max(0, (availableWidth - totalSeatWidth) / (input.group.columns - 1))
      : input.group.gapX;

  const gapY =
    input.group.rows > 1
      ? Math.max(0, (availableHeight - totalSeatHeight) / (input.group.rows - 1))
      : input.group.gapY;

  return {
    ...input.group,
    gapX,
    gapY,
  };
}
```

Recomendacao para a Alusa:

- resize livre: escala geometrica;
- resize com tecla modificadora: preservar tamanho do assento e redistribuir gaps;
- resize por painel de propriedades: permitir escolha explicita.

---

## 15. Konva: como evitar bugs de scale, stroke e transform

### 15.1. Problema do Transformer

O Transformer do Konva altera `scaleX` e `scaleY`. Se voce persistir esses valores sem normalizar, os proximos calculos de width/height, colisao e renderizacao podem ficar duplicados.

### 15.2. Normalizacao apos transformEnd

```ts
export function normalizeKonvaRectTransform(node: Konva.Rect): Bounds {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  const width = Math.max(MIN_CORRIDOR_THICKNESS, node.width() * scaleX);
  const height = Math.max(MIN_CORRIDOR_THICKNESS, node.height() * scaleY);

  node.scaleX(1);
  node.scaleY(1);
  node.width(width);
  node.height(height);

  return {
    x: node.x(),
    y: node.y(),
    width,
    height,
  };
}
```

### 15.3. Renderizacao segura

Ao renderizar objetos persistidos, prefira sempre passar escala normalizada:

```tsx
<Rect
  x={corridor.x}
  y={corridor.y}
  width={corridor.width}
  height={corridor.height}
  rotation={toDegrees(corridor.rotation)}
  scaleX={1}
  scaleY={1}
/>
```

### 15.4. Separacao de preview e commit

```txt
transformstart:
  snapshot = estado original

transform:
  atualiza preview local leve
  nao salva no banco
  nao recalcula toda a engine a cada pixel

transformend:
  normaliza Konva node
  chama applyMapOperation
  registra historico
  persiste se necessario
```

---

## 16. Snapping, guias e responsividade

### 16.1. Tipos de snapping

A ferramenta deve suportar:

- snap em bordas do SeatGroup;
- snap em centro do SeatGroup;
- snap em gaps entre fileiras;
- snap em gaps entre colunas;
- snap em bordas internas do grupo;
- snap entre corredores;
- snap em espessuras comuns;
- snap em angulos de rotacao, como 0, 15, 30, 45, 90 graus.

### 16.2. Threshold ajustado por zoom

```ts
export function getWorldSnapThreshold(input: { zoom: number; screenPx?: number }): number {
  return (input.screenPx ?? 8) / input.zoom;
}
```

### 16.3. Snap de corredor em gap entre assentos

```ts
export function getSeatGroupGapSnapLines(group: SeatGroup): SnapLine[] {
  const lines: SnapLine[] = [];

  for (let col = 0; col < group.columns - 1; col++) {
    const leftSeatX =
      group.paddingLeft + col * (group.seatWidth + group.gapX) + group.seatWidth;

    const gapCenterX = leftSeatX + group.gapX / 2;

    lines.push({
      axis: 'x',
      value: group.x + gapCenterX,
      kind: 'SEAT_COLUMN_GAP',
    });
  }

  for (let row = 0; row < group.rows - 1; row++) {
    const topSeatY =
      group.paddingTop + row * (group.seatHeight + group.gapY) + group.seatHeight;

    const gapCenterY = topSeatY + group.gapY / 2;

    lines.push({
      axis: 'y',
      value: group.y + gapCenterY,
      kind: 'SEAT_ROW_GAP',
    });
  }

  return lines;
}
```

Em grupos rotacionados, transforme essas linhas para world space antes de comparar com o ponteiro.

---

## 17. Operacoes do mapa

### 17.1. Comandos como fonte das alteracoes

Toda interacao deve virar uma operacao clara:

```ts
export type MapOperation =
  | { type: 'CREATE_SEAT_GROUP'; input: CreateSeatGroupInput }
  | { type: 'MOVE_SELECTION'; selectedIds: ID[]; delta: Point }
  | { type: 'RESIZE_SELECTION'; selectedIds: ID[]; from: Bounds; to: Bounds }
  | { type: 'ROTATE_SELECTION'; selectedIds: ID[]; angleDelta: number }
  | { type: 'MOVE_CORRIDOR'; corridorId: ID; nextTransform: Transform2D }
  | { type: 'RESIZE_CORRIDOR_EDGE'; corridorId: ID; handle: ResizeHandle; nextBounds: Bounds }
  | { type: 'ROTATE_CORRIDOR'; corridorId: ID; angleDelta: number }
  | { type: 'ATTACH_CORRIDOR_TO_GROUP_EDGE'; corridorId: ID; groupId: ID; edge: Edge }
  | { type: 'DETACH_CORRIDOR'; corridorId: ID }
  | { type: 'DELETE_SELECTION'; selectedIds: ID[] }
  | { type: 'DUPLICATE_SELECTION'; selectedIds: ID[]; offset: Point };
```

### 17.2. Pipeline principal

```ts
export function applyMapOperation(input: {
  contaId: ID;
  state: MapLayoutState;
  operation: MapOperation;
}): MapLayoutResult {
  assertTenantIsolation(input.contaId, input.state);

  const baseState = applyBaseOperation(input.state, input.operation);

  const normalizedState = normalizeMapState(baseState);

  const mergedCorridors = mergeIntersectingCorridors({
    corridors: normalizedState.corridors,
  });

  const derivedSeats = deriveAllSeats({
    groups: normalizedState.seatGroups,
    seats: normalizedState.seats,
  });

  const impacts = calculateAllCorridorImpacts({
    seatGroups: normalizedState.seatGroups,
    seats: derivedSeats,
    corridors: mergedCorridors,
  });

  const warnings = validateMapLayout({
    ...normalizedState,
    corridors: mergedCorridors,
    impacts,
  });

  return {
    state: {
      ...normalizedState,
      corridors: mergedCorridors,
      impacts,
    },
    warnings,
  };
}
```

---

## 18. Todos os principais cenarios e comportamento esperado

### 18.1. Criar grupo 5x10

Esperado:

- cria um SeatGroup;
- cria/persiste 50 assentos ou deriva 50 assentos;
- labels estaveis;
- bounds do grupo calculado corretamente;
- nenhum corridor impact.

### 18.2. Mover SeatGroup sozinho

Esperado:

- `group.x` e `group.y` mudam;
- `rowIndex` e `columnIndex` nao mudam;
- labels nao mudam;
- corredores fora da selecao podem recalcular impacto no fim.

### 18.3. Mover corredor sobre assentos

Esperado:

- enquanto arrasta: preview leve;
- ao soltar: engine detecta impacto;
- assentos afetados ocultam, bloqueiam ou deslocam conforme modo;
- SeatGroup continua unico.

### 18.4. Esticar uma aresta do corredor sobre os assentos

Esperado:

- aresta oposta fica fixa;
- corredor aumenta na direcao correta;
- padding e espessura minima respeitados;
- reflow recalcula apenas no final ou com throttle;
- assentos se reorganizam sem alterar labels.

### 18.5. Reduzir corredor ate quase 0px

Esperado:

- engine aplica espessura minima;
- nunca permite width/height menor que minimo;
- evita corredor fantasma de 1px.

### 18.6. Corredor entre gaps de colunas

Esperado:

- se couber no gap + padding, nao precisa ocultar assentos;
- se padding invadir assentos, aplica impacto;
- snap visual ajuda o usuario a posicionar exatamente no meio do gap.

### 18.7. Corredor sobre assento individual

Esperado:

- assento atingido vira `HIDDEN_BY_CORRIDOR` ou `BLOCKED`;
- label do assento continua reservado no sistema;
- se corredor for removido, assento volta ao status anterior, se nao houver bloqueio manual.

### 18.8. Corredor vertical na lateral esquerda interna

Esperado:

- pode ser anexado ao edge esquerdo;
- aumenta paddingLeft ou aplica impacto;
- assentos nao invadem corredor;
- labels continuam.

### 18.9. Corredor vertical na lateral direita interna

Esperado:

- pode ser anexado ao edge direito;
- aumenta paddingRight ou aplica impacto;
- se esticar para dentro, ultima coluna reage;
- se esticar para fora, grupo pode aumentar bounds externo, conforme regra.

### 18.10. Corredor horizontal na borda superior interna

Esperado:

- aumenta paddingTop ou desloca fileiras para baixo;
- primeira fileira nao fica por cima do corredor;
- snap em borda interna superior.

### 18.11. Corredor horizontal na borda inferior interna

Esperado:

- aumenta paddingBottom ou impacta ultimas fileiras;
- se nao colidir, nao mexe nos assentos;
- se usuario aumentar altura, reflow progressivo.

### 18.12. Dois corredores formando L

Esperado:

- corredores se unem se `mergeOnIntersect` estiver ativo;
- forma composta tem uma area unica de exclusao;
- assentos no canto interno do L nao ficam sobrepostos;
- offsets nao duplicam.

### 18.13. Dois corredores formando +

Esperado:

- uniao antes do impacto;
- assentos podem formar quatro blocos visuais;
- labels continuam estaveis;
- selecao da forma composta move o conjunto.

### 18.14. Corredores formando T

Esperado:

- uniao em uma forma composta;
- reflow preserva distancia minima no encontro;
- resize de uma haste nao distorce outra se ela nao estiver selecionada.

### 18.15. Corredores sobrepostos

Esperado:

- normalizacao e uniao;
- um assento afetado por ambos nao recebe offset duplicado;
- visual nao fica com linhas internas duplicadas, a menos que a UI mostre segmentos como edicao.

### 18.16. Rotacionar corredor dentro do grupo

Esperado:

- corredor vira poligono rotacionado;
- colisao por poligono, nao por bounding box simples;
- assentos atingidos sao calculados corretamente;
- em modo responsivo, use eixo dominante ou bloqueie/oculte para evitar reflow estranho.

### 18.17. Rotacionar SeatGroup sozinho com corredor fora da selecao

Esperado:

- assentos rotacionam juntos pelo transform do grupo;
- corredor permanece no lugar;
- engine recalcula interseccoes no world space;
- labels nao mudam.

### 18.18. Rotacionar SeatGroup e corredores juntos

Esperado:

- todos orbitam centro comum;
- posicoes relativas preservadas;
- corredores continuam dentro do layout;
- impacto final recalculado no `rotateEnd`.

### 18.19. Selecionar tudo e mover

Esperado:

- aplica delta comum;
- nao recalcula reflow em cada pixel;
- nao perde posicao relativa;
- no fim, apenas normaliza e valida.

### 18.20. Selecionar tudo e redimensionar

Esperado:

- calcula bounds comum;
- aplica escala proporcional ou modo escolhido;
- normaliza transform;
- recalcula impacto;
- labels e ids permanecem.

### 18.21. Duplicar grupo com corredores

Esperado:

- novos ids;
- labels podem ser mantidos ou recalculados conforme regra;
- impactos recalculados para os novos ids;
- objetos duplicados preservam posicao relativa.

### 18.22. Remover corredor

Esperado:

- remove CorridorImpact associado;
- assentos voltam para posicao derivada original;
- assentos bloqueados manualmente continuam bloqueados;
- assentos ocultos apenas pelo corredor reaparecem.

### 18.23. Undo/redo

Esperado:

- cada operacao tem estado anterior e posterior;
- reflow e derivado, entao pode ser recalculado;
- evitar salvar snapshots gigantes a cada movimento de mouse;
- salvar operacoes de alto nivel.

### 18.24. Zoom do canvas

Esperado:

- zoom nao altera medidas reais;
- snapping usa threshold em pixels de tela convertido para world units;
- stroke e handles podem se adaptar visualmente.

### 18.25. Exportar/importar mapa

Esperado:

- ids, group config, seats e corridors preservados;
- reabrir mapa gera mesmo visual;
- nao depender de `scaleX/scaleY` persistido pelo Konva.

---

## 19. Validacoes e invariantes

### 19.1. Invariantes de SeatGroup

```ts
export function validateSeatGroup(group: SeatGroup): MapLayoutWarning[] {
  const warnings: MapLayoutWarning[] = [];

  if (group.rows < 1) warnings.push({ code: 'INVALID_ROWS', severity: 'error' });
  if (group.columns < 1) warnings.push({ code: 'INVALID_COLUMNS', severity: 'error' });
  if (group.seatWidth <= 0) warnings.push({ code: 'INVALID_SEAT_WIDTH', severity: 'error' });
  if (group.seatHeight <= 0) warnings.push({ code: 'INVALID_SEAT_HEIGHT', severity: 'error' });
  if (group.gapX < 0) warnings.push({ code: 'INVALID_GAP_X', severity: 'error' });
  if (group.gapY < 0) warnings.push({ code: 'INVALID_GAP_Y', severity: 'error' });

  return warnings;
}
```

### 19.2. Invariantes de corredor

```ts
export function validateCorridor(corridor: SmartCorridor): MapLayoutWarning[] {
  const warnings: MapLayoutWarning[] = [];

  if (corridor.width < corridor.behavior.minThickness) {
    warnings.push({ code: 'CORRIDOR_WIDTH_BELOW_MINIMUM', severity: 'warning' });
  }

  if (corridor.height < corridor.behavior.minThickness) {
    warnings.push({ code: 'CORRIDOR_HEIGHT_BELOW_MINIMUM', severity: 'warning' });
  }

  return warnings;
}
```

### 19.3. Invariantes globais

- nenhum objeto pode mudar `contaId`;
- nenhum assento pode trocar `groupId` automaticamente por causa de corredor;
- nenhum label pode ser recalculado por posicao visual;
- nenhum corredor pode ter espessura abaixo do minimo;
- nenhum `scaleX/scaleY` vindo do Konva deve ser persistido como fonte de verdade;
- colisao de objeto rotacionado deve usar poligono;
- corredores unidos devem impactar assentos uma unica vez;
- operacoes devem ser idempotentes quando aplicadas ao mesmo snapshot.

---

## 20. Persistencia e isolamento multi-tenant

### 20.1. Regra Alusa

Todos os dados do mapa devem ser isolados por `contaId`. O editor de mapas pode parecer uma funcionalidade visual, mas ainda pertence a uma conta/escola.

### 20.2. Exemplo de tabelas conceituais

Nao assuma que estas tabelas ja existem. Sao sugestoes de modelagem.

```prisma
model MapLayout {
  id        String   @id @default(cuid())
  contaId   String
  name      String
  version   Int      @default(1)
  data      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([contaId])
}
```

Para MVP, salvar `data Json` pode acelerar. Para evolucao, normalizar assentos e objetos pode ser melhor.

### 20.3. Persistencia como documento versionado

```ts
export type PersistedMapLayoutDocument = {
  version: 1;
  contaId: ID;
  seatGroups: SeatGroup[];
  seats: Seat[];
  corridors: SmartCorridor[];
  objects: MapObject[];
  attachments: CorridorAttachment[];
};
```

### 20.4. Validacao na API

```ts
export async function saveMapLayoutHandler(req: Request) {
  const session = await auth();
  const contaId = requireContaId(session);

  const body = await req.json();
  const input = saveMapLayoutSchema.parse(body);

  assertSameContaId(contaId, input.document);

  await prisma.mapLayout.update({
    where: { id_contaId: { id: input.id, contaId } },
    data: { data: input.document },
  });

  return Response.json({ ok: true });
}
```

---

## 21. Estado local, historico e undo/redo

### 21.1. Estado do editor

```ts
export type MapEditorState = {
  layout: MapLayoutState;
  selection: ID[];
  interaction?: ActiveInteraction;
  history: {
    past: MapOperation[];
    future: MapOperation[];
  };
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };
};
```

### 21.2. ActiveInteraction

```ts
export type ActiveInteraction =
  | {
      type: 'DRAG_SELECTION';
      selectedIds: ID[];
      startPointer: Point;
      snapshot: MapObjectSnapshot[];
    }
  | {
      type: 'RESIZE_CORRIDOR_EDGE';
      corridorId: ID;
      handle: ResizeHandle;
      startPointer: Point;
      snapshot: SmartCorridor;
    }
  | {
      type: 'ROTATE_SELECTION';
      selectedIds: ID[];
      center: Point;
      startAngle: number;
      snapshot: MapObjectSnapshot[];
    };
```

### 21.3. Historico por operacao, nao por pixel

Evite salvar uma entrada de historico para cada `mousemove`.

Correto:

```txt
mousedown -> inicia interacao
mousemove -> preview
mouseup -> salva uma operacao MOVE_SELECTION
```

---

## 22. UI e experiencia do usuario

### 22.1. Painel de propriedades do SeatGroup

Campos recomendados:

- nome do grupo;
- fileiras;
- colunas;
- largura do assento;
- altura do assento;
- gap horizontal;
- gap vertical;
- padding top/right/bottom/left;
- letra inicial;
- numero inicial;
- direcao de numeracao;
- modo de resize;
- comportamento quando corredor invade assentos.

### 22.2. Painel de propriedades do corredor

Campos recomendados:

- nome;
- largura;
- altura;
- espessura;
- rotacao;
- padding top/right/bottom/left;
- comportamento: ocultar, bloquear, empurrar ou dividir visualmente;
- anexar a borda interna de grupo;
- unir automaticamente com corredores;
- snap em gaps;
- snap em bordas internas.

### 22.3. Guias visuais

Durante arraste ou resize:

- mostrar area real do corredor;
- mostrar area de impacto incluindo padding;
- destacar assentos afetados;
- mostrar linhas de snap;
- mostrar labels sem recalcular;
- opcionalmente mostrar blocos visuais resultantes.

### 22.4. Feedback de conflitos

Exemplos de mensagens:

```txt
Corredor abaixo da espessura minima. Ajustado automaticamente para 8px.
```

```txt
Alguns assentos foram bloqueados porque ficaram dentro da area do corredor.
```

```txt
O corredor foi anexado a borda interna esquerda do grupo.
```

---

## 23. Renderizacao com Konva

### 23.1. Camadas recomendadas

```txt
Layer 1 - background/grid/listening false
Layer 2 - assentos/listening false quando nao editando individualmente
Layer 3 - corredores/listening true
Layer 4 - objetos selecionaveis principais
Layer 5 - transformer, snap guides e overlays
Layer 6 - drag layer temporaria
```

### 23.2. SeatShape

```tsx
export function SeatShape({ seat }: { seat: DerivedSeat }) {
  if (seat.hidden) return null;

  return (
    <Group
      x={seat.visualX}
      y={seat.visualY}
      rotation={toDegrees(seat.rotation)}
      scaleX={1}
      scaleY={1}
      listening={false}
    >
      <Rect
        width={seat.width}
        height={seat.height}
        cornerRadius={4}
        strokeWidth={1}
      />
      <Text
        text={seat.label}
        width={seat.width}
        height={seat.height}
        align="center"
        verticalAlign="middle"
        scaleX={1}
        scaleY={1}
      />
    </Group>
  );
}
```

### 23.3. SmartCorridorShape

```tsx
export function SmartCorridorShape({
  corridor,
  isSelected,
  onSelect,
  onTransformEnd,
}: Props) {
  const ref = useRef<Konva.Rect>(null);

  return (
    <Rect
      ref={ref}
      x={corridor.x}
      y={corridor.y}
      width={corridor.width}
      height={corridor.height}
      rotation={toDegrees(corridor.rotation)}
      draggable={!corridor.locked}
      scaleX={1}
      scaleY={1}
      onClick={onSelect}
      onTransformEnd={() => {
        if (!ref.current) return;
        const bounds = normalizeKonvaRectTransform(ref.current);
        onTransformEnd(bounds);
      }}
    />
  );
}
```

---

## 24. Algoritmo completo de impacto de corredores

### 24.1. Entrada

```ts
export type CalculateCorridorImpactsInput = {
  seatGroups: SeatGroup[];
  seats: DerivedSeat[];
  corridors: SmartCorridor[];
};
```

### 24.2. Saida

```ts
export type CalculateCorridorImpactsOutput = {
  impacts: CorridorImpact[];
};
```

### 24.3. Pipeline

```ts
export function calculateAllCorridorImpacts(
  input: CalculateCorridorImpactsInput
): CorridorImpact[] {
  const normalizedCorridors = input.corridors.map(normalizeCorridor);

  const corridorPolygons = normalizedCorridors.map((corridor) => ({
    corridor,
    polygon: corridorToPolygon(corridor),
    bounds: polygonToBounds(corridorToPolygon(corridor)),
  }));

  const merged = mergeIntersectingCorridorGeometries(corridorPolygons);

  const seatIndex = buildSpatialIndex(
    input.seats.map((seat) => ({
      id: seat.id,
      kind: 'SEAT',
      minX: seat.worldBounds.x,
      minY: seat.worldBounds.y,
      maxX: seat.worldBounds.x + seat.worldBounds.width,
      maxY: seat.worldBounds.y + seat.worldBounds.height,
    }))
  );

  const impacts: CorridorImpact[] = [];

  for (const mergedCorridor of merged) {
    const candidateItems = seatIndex.search(boundsToSpatialItem(mergedCorridor.bounds));
    const candidateSeats = input.seats.filter((seat) =>
      candidateItems.some((item) => item.id === seat.id)
    );

    const affectedSeats = candidateSeats.filter((seat) =>
      polygonsIntersect(mergedCorridor.polygon, seat.worldPolygon)
    );

    const impactsByGroup = groupAffectedSeatsBySeatGroup({
      affectedSeats,
      mergedCorridor,
    });

    impacts.push(...impactsByGroup);
  }

  return impacts;
}
```

### 24.4. Observacao importante

`polygonsIntersect` pode ser implementado com SAT para convexos simples, ou usando uma biblioteca robusta para geometrias compostas. Para corredores em L, T e +, prefira operacoes booleanas de poligonos e mantenha o resultado como multipoligono.

---

## 25. Estrategias para corredores diagonais e rotacionados

Corredores diagonais sao mais complexos que horizontais/verticais. Existem tres abordagens.

### 25.1. Abordagem conservadora: bloquear/ocultar

Se o corredor estiver diagonal, nao tente empurrar blocos automaticamente. Apenas bloqueie ou oculte assentos atingidos.

Vantagem:

- previsivel;
- menos bugs;
- melhor para MVP.

### 25.2. Abordagem por eixo dominante

Classifique se o corredor diagonal e mais horizontal ou vertical e aplique offset no eixo dominante.

Vantagem:

- responsivo;
- ainda relativamente simples.

Risco:

- pode parecer estranho em angulos proximos de 45 graus.

### 25.3. Abordagem avancada: particionamento por poligono

Use o poligono do corredor para dividir visualmente o SeatGroup em regioes. E mais robusto, mas muito mais caro de implementar.

Recomendacao para Alusa:

```txt
MVP: HIDE_SEATS/BLOCK_SEATS para corredores diagonais.
Evolucao: SPLIT_VISUAL_BLOCKS por poligono.
```

---

## 26. Testes com Vitest

### 26.1. Teste de labels estaveis

```ts
it('keeps labels stable after corridor impact', () => {
  const group = createSeatGroup({ rows: 2, columns: 4, rowLabelStart: 'A' });
  const seatsBefore = deriveSeats(group);

  const result = applyMapOperation({
    state: createState({ groups: [group] }),
    operation: createVerticalCorridorOverMiddle(group),
  });

  const seatsAfter = deriveSeatsWithImpacts(result.state);

  expect(seatsAfter.map((seat) => seat.label)).toEqual(
    seatsBefore.map((seat) => seat.label)
  );
});
```

### 26.2. Teste de resize por aresta

```ts
it('resizes corridor from right edge without moving left edge', () => {
  const corridor = createCorridor({ x: 100, y: 100, width: 50, height: 200 });

  const next = resizeBoundsByHandle({
    original: { x: corridor.x, y: corridor.y, width: corridor.width, height: corridor.height },
    handle: 'right',
    delta: { x: 40, y: 0 },
    minWidth: 8,
    minHeight: 8,
  });

  expect(next.x).toBe(100);
  expect(next.width).toBe(90);
});
```

### 26.3. Teste de L sem offset duplicado

```ts
it('does not apply duplicate offset when corridors merge into L', () => {
  const state = createStateWithSeatGroupAndTwoCorridorsFormingL();

  const result = applyMapOperation({
    state,
    operation: { type: 'RECALCULATE_LAYOUT' },
  });

  const impactedSeat = findSeat(result.state, 'B3');

  expect(impactedSeat.corridorOffset.dx).toBeLessThanOrEqual(MAX_EXPECTED_SHIFT_X);
  expect(impactedSeat.corridorOffset.dy).toBeLessThanOrEqual(MAX_EXPECTED_SHIFT_Y);
});
```

### 26.4. Teste de rotacao conjunta

```ts
it('rotates seat group and corridor together preserving relative distance', () => {
  const state = createStateWithSeatGroupAndCorridor();
  const beforeDistance = distanceBetweenObjects(state.group, state.corridor);

  const result = applyMapOperation({
    state,
    operation: {
      type: 'ROTATE_SELECTION',
      selectedIds: [state.group.id, state.corridor.id],
      angleDelta: Math.PI / 2,
    },
  });

  const afterDistance = distanceBetweenObjects(result.state.group, result.state.corridor);
  expect(afterDistance).toBeCloseTo(beforeDistance, 4);
});
```

---

## 27. Testes E2E com Playwright

### 27.1. Cenários E2E prioritarios

1. Criar grupo de assentos 5x10.
2. Adicionar corredor vertical no meio.
3. Esticar a aresta direita do corredor sobre os assentos.
4. Confirmar que labels continuam iguais.
5. Mover o corredor para a lateral esquerda interna.
6. Aumentar padding do corredor pelo painel.
7. Confirmar que assentos se afastam.
8. Criar segundo corredor formando L.
9. Criar terceiro corredor formando +.
10. Selecionar tudo e mover.
11. Selecionar tudo e rotacionar.
12. Desfazer e refazer.
13. Salvar mapa.
14. Reabrir mapa.
15. Comparar visual e dados.

### 27.2. Exemplo conceitual

```ts
test('smart corridor preserves seat labels after edge resize', async ({ page }) => {
  await page.goto('/maps/new');

  await createSeatGroup(page, { rows: 5, columns: 10 });
  await createSmartCorridor(page, { orientation: 'vertical' });
  await dragCorridorToMiddleOfSeatGroup(page);
  await resizeCorridorEdge(page, 'right', { dx: 80, dy: 0 });

  await expectSeatLabel(page, 'A1').toBeVisible();
  await expectSeatLabel(page, 'A10').toBeVisible();
  await expectNoSeatOverlap(page);
});
```

---

## 28. Erros comuns e como evitar

### 28.1. Usar bounding box simples para tudo

Bounding box simples funciona para objetos sem rotacao. Com rotacao, gera falsos positivos e falsos negativos.

Solucao: converter para poligono e colidir no world space.

### 28.2. Alterar posicao-base do assento por causa do corredor

Isso quebra undo, remove corredor, numeracao, gaps e reflow.

Solucao: usar `CorridorImpact` derivado.

### 28.3. Persistir `scaleX/scaleY` do Konva

Isso gera double scaling.

Solucao: normalizar em `transformEnd`.

### 28.4. Recalcular labels por posicao visual

Isso embaralha numeracao quando corredor divide o grupo.

Solucao: label por `rowIndex`/`columnIndex`.

### 28.5. Aplicar impacto de corredores um por um sem uniao

Isso desloca o mesmo assento varias vezes.

Solucao: unir corredores intersectantes antes do impacto.

### 28.6. Fazer tudo em React state sem engine pura

Isso cria `useEffect` em cascata, bugs intermitentes e baixa testabilidade.

Solucao: comandos + engine pura + renderizacao derivada.

---

## 29. Plano de implementacao recomendado

### Fase 1 - Modelo parametrico

Entregas:

- `SeatGroup`;
- `Seat`;
- `deriveSeats`;
- `labelSeats`;
- validacao Zod;
- testes de labels e bounds.

### Fase 2 - Corredor simples

Entregas:

- `SmartCorridor` retangular;
- normalizacao de espessura;
- colisao sem rotacao;
- impacto `HIDE_SEATS` ou `BLOCK_SEATS`;
- renderizacao no canvas.

### Fase 3 - Reflow responsivo

Entregas:

- impacto `SPLIT_VISUAL_BLOCKS`;
- offsets por eixo dominante;
- preservacao de gaps;
- resize por aresta;
- padding do corredor.

### Fase 4 - Interseccoes e formas compostas

Entregas:

- uniao de corredores;
- L, T, +;
- evitar offset duplicado;
- highlights visuais;
- testes de composicao.

### Fase 5 - Transformacoes avancadas

Entregas:

- selecao multipla;
- resize multiplo;
- rotacao conjunta;
- conversao world/local;
- snapshots de interacao;
- undo/redo.

### Fase 6 - Performance e polimento

Entregas:

- RBush;
- camadas Konva otimizadas;
- listening false;
- drag layer;
- batchDraw quando necessario;
- Playwright E2E;
- documentacao de regras.

---

## 30. Checklist final de qualidade

Antes de considerar a ferramenta pronta:

- [ ] Criar SeatGroup com labels corretas.
- [ ] Mover SeatGroup sem alterar labels.
- [ ] Redimensionar SeatGroup sem perder estrutura.
- [ ] Rotacionar SeatGroup sem desalinhamento.
- [ ] Criar corredor horizontal e vertical.
- [ ] Esticar uma aresta do corredor sobre assentos.
- [ ] Corredor em lateral esquerda interna.
- [ ] Corredor em lateral direita interna.
- [ ] Corredor em borda superior interna.
- [ ] Corredor em borda inferior interna.
- [ ] Padding do corredor afastando assentos.
- [ ] Corredores formando L.
- [ ] Corredores formando T.
- [ ] Corredores formando +.
- [ ] Rotacionar corredor dentro de grupo.
- [ ] Rotacionar grupo e corredor juntos.
- [ ] Selecionar tudo e mover.
- [ ] Selecionar tudo e redimensionar.
- [ ] Remover corredor e restaurar assentos.
- [ ] Undo/redo funcionando.
- [ ] Persistir e reabrir mapa sem diferenca visual.
- [ ] Sem `scaleX/scaleY` acumulado.
- [ ] Sem assentos sobrepostos.
- [ ] Sem numeracao embaralhada.
- [ ] Testes Vitest cobrindo engine.
- [ ] Testes Playwright cobrindo fluxo visual.

---

## 31. Referencias tecnicas consultadas

As referencias abaixo foram usadas como base de boas praticas para editor 2D, geometria, transformacoes, snapping, agrupamento, performance e operacoes booleanas de poligonos.

1. Konva - React Transformer: https://konvajs.org/docs/react/Transformer.html
2. Konva - Transformer scaleX/scaleY e reset de escala: https://konvajs.org/docs/select_and_transform/Ignore_Stroke_On_Transform.html
3. Konva - Performance tips: https://konvajs.org/docs/performance/All_Performance_Tips.html
4. tldraw - Shapes e Geometry system: https://tldraw.dev/sdk-features/shapes
5. tldraw - Snapping: https://tldraw.dev/sdk-features/snapping
6. tldraw - Groups: https://tldraw.dev/sdk-features/groups
7. tldraw - Shape transforms: https://tldraw.dev/sdk-features/shape-transforms
8. RBush - Spatial index: https://github.com/mourner/rbush
9. polygon-clipping - Boolean polygon operations: https://github.com/mfogel/polygon-clipping
10. Fabric.js - Transformations and matrices: https://fabricjs.com/docs/transformations/

---

## 32. Decisao arquitetural final

Para a Alusa, a implementacao correta e:

```txt
SeatGroup parametrico
+ assentos com identidade estavel
+ corredores como geometrias de exclusao
+ impactos derivados
+ engine pura testada
+ UI Konva apenas como render/interacao
```

Essa abordagem evita os principais bugs:

- assentos embaralhados;
- numeracao perdida;
- gaps inconsistentes;
- corredor empurrando duas vezes;
- scale acumulado;
- rotacao quebrada;
- selecao multipla perdendo posicao relativa;
- corredor em L, T ou + gerando sobreposicao;
- remover corredor sem restaurar layout.

A recomendacao e implementar primeiro a engine com testes unitarios e depois conectar a UI. Isso transforma o corredor inteligente em uma ferramenta previsivel, profissional e escalavel dentro do ecossistema da Alusa.

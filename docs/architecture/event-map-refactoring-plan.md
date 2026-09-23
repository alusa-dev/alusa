# Refatoração do construtor de mapas de eventos

## Objetivo

Adotar um modelo paramétrico explícito para mapas de eventos e remover o modelo
legado de `EventSeatGroup`, corredores inteligentes, reflow automático e estado
geométrico espalhado entre canvas, store e handlers.

O contrato canônico é:

```text
EventMapDocument
└── Section
    └── SeatBlock
        └── SeatRow
            └── Seat
```

Uma fileira possui um caminho determinístico (`LINE`, `ARC`, `POLYLINE` ou
`BEZIER`). Espaçamentos são dados de distribuição do bloco/fileira. Corredores
são o espaço entre blocos e não são entidades que empurram ou reorganizam
assentos.

## Estado final da arquitetura

- `packages/domain/src/map-engine/model`: documento canônico e tipos de
  geometria.
- `packages/domain/src/map-engine/layout`: criação de blocos, resolução de
  caminhos e projeção de assentos.
- `packages/domain/src/map-engine/commands` e `operations`: comandos
  determinísticos, duplicação, seleção e transformações.
- `apps/web/features/events/map/components`: editor paramétrico e propriedades
  de bloco/fileira.
- `packages/lib/src/events/map`: persistência, publicação e contratos públicos.
- `EventMap.draftDocument`: fonte de verdade do rascunho paramétrico.
- `EventMap.referenceChart`: configuração auxiliar de autoria, fora do
  documento vendável e da versão pública.
- `EventMapVersion.snapshot`: versão imutável publicada.
- `EventSeat` e `EventMapPublicSeat`: inventário operacional derivado para venda,
  reserva e emissão de tickets.

## Fases executadas

### 1. Domínio canônico

- Criar `EventMapDocument`, `MapSection`, `MapSeatBlock`, `MapSeatRow` e
  `MapSeat`.
- Implementar paths de fileira, transformação local/mundo, distribuição e
  diagnósticos de layout.
- Criar comandos de documento para criar seção, bloco, fileira, assento e
  alterar path.
- Manter IDs estáveis dos assentos quando uma fileira muda de geometria.
- Garantir que preview e commit usem o mesmo resolver determinístico.

### 2. Editor e workspace

- Trocar criação de grid por criação de `SeatBlock`.
- Renderizar blocos e fileiras paramétricos, sem `SeatGroupNode`.
- Remover ferramentas, sessões, adapters, fixtures e E2E de corredor.
- Remover aliases de `SeatGrid` e nomes de arquivos que representavam a
  abstração antiga.
- Manter agrupamento visual de objetos separado do domínio de assentos.

### 3. API e persistência

- Receber e validar `document` com Zod.
- Projetar o documento em seções, objetos e assentos operacionais para manter
  compatibilidade com reservas, vendas e relatórios.
- Preservar `status`, acessibilidade e visibilidade dos assentos por ID.
- Publicar snapshot imutável e gerar inventário público a partir da versão.
- Remover `seatGroups` e `groupId` dos DTOs, serviços e metadados públicos.
- Preservar isolamento por `contaId` em todas as queries e escritas.
- Permitir upload, substituição, remoção, visibilidade, opacidade e
  transformação da planta de referência por uma rota dedicada.
- Validar que a chave de armazenamento da planta pertence ao mesmo tenant e
  ao mesmo mapa antes de aceitar qualquer atualização.
- Excluir explicitamente `referenceChart` do snapshot publicado e do fluxo de
  inventário/reserva.

### 3.1. Planta de referência e calibração

- Renderizar a imagem como camada auxiliar abaixo do mapa paramétrico.
- Manter a imagem bloqueada e não selecionável por padrão; a movimentação,
  escala e rotação só ficam disponíveis no modo explícito `Editar planta`.
- Persistir `seatDiameter`, `seatPitch` e `rowPitch` como preset geométrico,
  sem recalcular automaticamente objetos já criados.
- Usar a calibração como default determinístico para novos blocos e fileiras.
- Manter a planta fora de `MapLayersPanel`, reforçando que ela é uma
  ferramenta de autoria e não um objeto vendável.

### 4. Banco e migração

1. Fazer backup e validar o ambiente alvo.
2. Executar a prévia:

   ```bash
   pnpm events:map:migrate-document
   ```

3. Conferir os mapas e diagnósticos migrados.
4. Persistir a migração:

   ```bash
   pnpm events:map:migrate-document --apply
   ```

5. Confirmar que todos os mapas relevantes têm `draftDocument` preenchido.
6. Aplicar a migration de remoção de `EventSeatGroup`/`EventSeat.groupId`:

   ```bash
   pnpm prisma migrate deploy
   ```

A migration destrutiva deve ser aplicada somente depois do passo 4. O script de
compatibilidade usa SQL direto de propósito: ele continua conseguindo ler o
modelo antigo antes da remoção das tabelas mesmo quando o Prisma Client final
já não expõe `EventSeatGroup`.

## Invariantes obrigatórias

- Nenhuma operação do editor pode mover um assento vizinho como efeito colateral.
- Uma interação do usuário gera no máximo uma entrada de histórico.
- Preview e commit devem gerar os mesmos IDs, labels e posições.
- Mudanças geométricas não podem resetar disponibilidade, venda ou bloqueio.
- Publicação não altera o inventário publicado existente sem uma nova versão.
- Toda entidade persistida continua escopada por `contaId`.
- Diagnósticos bloqueantes impedem salvar/publicar; warnings são explícitos.
- O consumidor público nunca depende do rascunho mutável.

## Verificação antes de merge

```bash
pnpm prisma generate --schema=prisma/schema.prisma
pnpm --filter @alusa/domain build
pnpm --filter @alusa/lib typecheck
pnpm --filter @alusa/web typecheck
```

Também devem passar os testes unitários do domínio paramétrico, os testes do
store do editor, os adapters Konva e os fluxos E2E de criação, alteração de
fileira, publicação, seleção e venda.

## Riscos residuais e rollout

- Mapas sem `draftDocument` precisam ser migrados antes do deploy da migration
  destrutiva.
- A projeção operacional deve ser monitorada comparando capacidade do documento,
  `EventSeat` e lotes numerados.
- O rollout recomendado é: migrar em dry-run, aplicar em staging, publicar uma
  versão de teste, validar reserva/venda, e só então promover para produção.
- Após a confirmação do rollout, referências históricas à migration antiga devem
  permanecer somente em migrations já aplicadas; código ativo não deve importar
  o modelo removido.

## Plano completo de execução do creator

Este documento consolida o plano de produto, arquitetura e implementação para
que o fluxo de criação de mapas tenha uma única fonte de verdade. As fases
abaixo complementam o estado canônico já existente na working tree e definem o
que ainda precisa ser fechado antes da remoção definitiva do legado.

## 1. Fluxo canônico do usuário

Dentro do evento, o ponto de entrada deve ser:

```text
Evento
└── Mapas de assentos
    ├── Usar mapa existente
    └── Criar novo mapa
```

Ao escolher “Criar novo mapa”, o usuário passa por uma página de decisão antes
do editor:

```text
Criar novo mapa
├── Em branco
└── Importar planta
```

“Usar mapa existente” é uma ação separada para selecionar ou reutilizar um mapa
já existente. A escolha inicial não deve abrir um formulário técnico nem exigir
um template. Ela apenas define a preparação do documento:

- **Em branco:** cria um draft vazio com defaults geométricos.
- **Importar planta:** cria o draft e inicia o upload da planta de referência.

O creator deve orientar o usuário pelas seguintes fases:

```text
1. Criar espaço
2. Criar lugares
3. Organizar e identificar
4. Configurar venda
5. Revisar
6. Preview do comprador
7. Publicar
```

Essas fases são uma orientação de produto, não uma mistura de ciclos de vida.
O evento pode estar em um estado enquanto o mapa é editado ou publicado em
outro. O draft do mapa não deve depender de o evento estar em draft.

## 2. Direção de interface

O editor deve parecer uma planta técnica clara, não uma ferramenta CAD. A
experiência deve ser precisa, espacial e acolhedora para funcionários de
escolas e produtores de eventos que não conhecem geometria computacional.

### 2.1 Princípios visuais

- canvas claro e limpo, com estrutura em grafite;
- violeta da Alusa para seleção, foco e ação primária;
- âmbar para avisos de revisão;
- vermelho apenas para impedimentos;
- verde para validações concluídas;
- referência importada como camada fantasma, abaixo do mapa;
- controles técnicos revelados progressivamente no contexto do objeto.

A assinatura da experiência é “criar arrastando e refinar no inspector”. O
usuário deve ver o bloco antes de preencher detalhes.

### 2.2 Hugeicons no creator

O creator deve usar Hugeicons de forma coerente, sem misturar Lucide,
Heroicons e Hugeicons na mesma superfície de edição.

Implementação:

1. adicionar `@hugeicons/react` e `@hugeicons/core-free-icons` em
   `apps/web`;
2. criar `apps/web/components/icons/hugeicons.tsx` como adapter semântico;
3. mapear conceitos de negócio para ícones, como mapa, seção, bloco, fileira,
   assento, palco, upload, planta de referência, camadas, seleção, pan, zoom,
   undo, redo, bloqueio, visibilidade, edição, exclusão, revisão e publicação;
4. confirmar cada nome no catálogo local da skill Hugeicons antes de importar;
5. trocar imports diretos nos componentes do creator pelo adapter;
6. padronizar tamanho, peso, estados ativo/desabilitado e acessibilidade;
7. não usar ícone como única comunicação de uma ação destrutiva.

A primeira migração abrange toolbar, inspector, árvore, painel da planta,
revisão e navegação do creator. A superfície pública pode ser migrada em lote
separado.

## 3. Arquitetura alvo do workspace

O domínio canônico não pode importar React, Next.js, Konva, Prisma, DOM,
`fetch` ou Zustand.

```text
apps/web/
├── app/api/events/[eventId]/maps/
├── app/(dashboard)/events/[eventId]/maps/
├── components/icons/hugeicons.tsx
└── features/events/map/
    ├── components/       # canvas, toolbar, inspector, árvore e revisão
    ├── hooks/             # coordenação da UI e interações
    ├── state/             # store visual, seleção e histórico
    ├── adapters/          # Konva, API e serialização de tela
    └── types/             # tipos exclusivos da UI

packages/domain/src/map-engine/
├── model/                # documento e entidades canônicas
├── geometry/             # paths, transforms e distribuição
├── commands/             # operações puras e determinísticas
├── numbering/            # identificação de fileiras e assentos
├── validation/           # invariantes e diagnósticos
├── publication/          # resolução do snapshot público
└── migrations/           # adaptação explícita de documentos antigos

packages/lib/src/events/map/
├── schemas/              # entradas Zod e DTOs
├── use-cases/            # criação, edição, validação e publicação
├── services/             # persistência e orquestração
└── policies/             # autorização e proteções operacionais

packages/database/
├── prisma/schema.prisma
├── prisma/migrations/
└── src/                  # clients, transações e repositórios
```

Dependências permitidas:

```text
apps/web → packages/lib → packages/domain
packages/lib → packages/database
packages/ui → primitives visuais compartilhadas
```

Route handlers devem autenticar, validar, chamar um caso de uso e traduzir o
resultado para HTTP. Regra de negócio não deve ficar em componentes, handlers
ou nodes do canvas.

## 4. Contrato do domínio

O documento persistido é a fonte de verdade do draft. Canvas, árvore,
inspector, contadores, seleção e preview são projeções dele.

```text
EventMapDocument
└── Section
    └── SeatBlock
        └── SeatRow
            └── Seat
```

Uma seção contém blocos. Um bloco é a unidade principal de criação e contém
fileiras. Fileiras contêm assentos. Não manter listas paralelas de assentos,
grupos ou children que possam divergir da árvore canônica.

O documento deve conter, no mínimo:

```ts
type EventMapDocument = {
  schemaVersion: number
  mapId: string
  eventId: string
  sections: Section[]
  visualElements: VisualElement[]
  defaults: MapGeometryDefaults
  metadata: MapMetadata
}
```

`referenceChart` é configuração de autoria associada ao mapa, não conteúdo
vendável. Não deve ser incluído no snapshot público.

IDs são estáveis. Mover, girar, curvar ou alterar espaçamento preserva IDs.
Aumentar a quantidade cria somente novos IDs. Reduzir a quantidade consulta
proteções operacionais antes de remover qualquer assento.

Totais são derivados do documento:

```text
totalSeats = soma(rows[].seats.length)
```

O mesmo selector deve alimentar rodapé, árvore, inspector, revisão e resumo de
API.

## 5. Geometria determinística

### 5.1 Coordenadas e palco

Cada bloco usa coordenadas locais:

```text
X = ao longo da fileira, do início ao fim do path
Y = da frente para o fundo do bloco
```

Depois o bloco é transformado para a seção e para o mundo. “Frente” nunca é
definida pela parte superior do canvas.

O palco fornece um ponto focal e orientação inicial, quando existir. O bloco
mantém sua transformação. Mover o palco não gira blocos automaticamente; a
ação “Orientar para o palco” deve ser explícita. Mapas sem palco continuam
válidos e mapas com mais de um palco podem usar `focalPointId`.

### 5.2 Paths e distribuição

O engine suporta `LINE`, `ARC`, `POLYLINE` e `BEZIER`. Na UX, isso aparece como
Reta, Curva e Segmentada.

A posição dos assentos é calculada por comprimento real:

- linha: distância linear;
- arco: comprimento do arco;
- polyline: comprimento acumulado dos segmentos;
- Bézier: flattening/LUT determinístico.

Não usar incremento arbitrário de parâmetro ou ângulo como substituto da
distância.

Modos de distribuição:

```text
FIXED / Igual
    mesma quantidade por fileira

PROGRESSIVE / Progressiva
    quantidade inicial e final com interpolação e arredondamento definidos

FIT / Ajustar ao espaço
    quantidade calculada a partir do path e dos gaps disponíveis
```

Overrides de fileira são explícitos. Alterar a regra do bloco não destrói um
override; a fileira pode ser restaurada para automático.

### 5.3 Corredores

Corredor não é entidade inteligente. É um gap ou segmento excluído da
distribuição da própria fileira ou uma separação entre blocos.

```text
path da fileira
├── segmento de assentos
├── gap/corredor
└── segmento de assentos
```

O cálculo é local. Não há empurrão, reflow ou estabilização de outros blocos.
Sobreposição é diagnóstico; a correção é uma decisão explícita do usuário.

### 5.4 Planta de referência e calibração

```text
upload
→ posicionamento inicial
→ calibração
→ bloqueio automático
→ desenho por cima
```

A calibração registra defaults para novos blocos:

```ts
type MapCalibration = {
  seatDiameter: number
  seatPitch: number
  rowPitch: number
}
```

Ela não altera automaticamente objetos existentes. A camada oferece visibilidade,
opacidade, bloquear/desbloquear, editar, calibrar, substituir e remover. Em
modo normal, não é selecionável. O comprador nunca a vê.

## 6. Contratos de interação

### 6.1 Criação por arrasto

```text
Selecionar “Bloco de fileiras”
→ pointerDown define a origem
→ pointerMove atualiza preview efêmero
→ pointerUp resolve e cria o SeatBlock real
→ inspector contextual refina o resultado
```

Não abrir formulário técnico antes do primeiro resultado visual.

### 6.2 Inspector e navegação

- bloco selecionado: layout, distribuição, identificação e transformação;
- fileira selecionada: path, override e identificação;
- assento selecionado: identificação, status e venda;
- nenhum objeto: propriedades do mapa e ferramentas de autoria.

Navegação:

```text
clique normal  → bloco
duplo clique   → entrar no bloco/fileiras
selecionar     → fileira ou assento conforme o contexto
Escape         → subir um nível
```

Usar “fileiras”, “assentos por fileira”, “espaço entre assentos” e “espaço
entre fileiras”. Não usar “linhas”, “colunas” ou “tamanho” como campos
ambíguos de criação.

### 6.3 Seleção, exclusão e histórico

```ts
type EditorSelection =
  | { type: 'SECTION'; id: string }
  | { type: 'SEAT_BLOCK'; id: string }
  | { type: 'ROW'; blockId: string; id: string }
  | { type: 'SEAT'; blockId: string; rowId: string; id: string }
  | { type: 'VISUAL_ELEMENT'; id: string }
  | null
```

Árvore, hit testing, transformer, inspector, contadores e comandos devem usar
essa hierarquia. Excluir emite um comando de domínio:

- bloco remove bloco, fileiras e assentos atomicamente;
- fileira remove fileira e seus assentos;
- assento remove somente o assento;
- seção exige confirmação e proteção adequada;
- undo restaura a subárvore e IDs exatamente.

Assentos vendidos, reservados ou ticketados não podem ser apagados ou
reduzidos silenciosamente.

Cada gesto tem uma única entrada de histórico:

```text
estado inicial imutável
→ preview durante o gesto
→ mesmo cálculo no commit
→ uma entrada no undo/redo
```

Escape restaura o estado inicial. Zoom e pan não alteram o documento. O preview
de alta frequência é efêmero e pode usar `requestAnimationFrame`; o store
controla documento confirmado, seleção, ferramenta, histórico e status.

## 7. Separação comercial

“Construir mapa” e “Configurar venda” são modos distintos.

Construir mapa contém palco, seção, bloco, fileira, assento, planta de
referência, elementos visuais e diagnósticos espaciais.

Configurar venda contém tipo de ingresso, preço, disponibilidade, acessibilidade
e regras operacionais. Atribuições podem atingir seção, bloco, fileira ou
assento, com precedência:

```text
Seat > Row > SeatBlock > Section
```

Preço não é propriedade geométrica. Disponibilidade, reserva, pedido e ticket
não devem ser destruídos por uma alteração visual do draft.

## 8. API e casos de uso

Toda entrada HTTP usa Zod. Toda operação valida sessão, permissão e vínculo
com a `Conta` antes de carregar ou alterar o mapa.

Superfície recomendada:

```text
GET    /api/events/:eventId/maps
POST   /api/events/:eventId/maps
GET    /api/events/:eventId/maps/:mapId
PATCH  /api/events/:eventId/maps/:mapId

POST   /api/events/:eventId/maps/:mapId/reference-chart
PATCH  /api/events/:eventId/maps/:mapId/reference-chart
DELETE /api/events/:eventId/maps/:mapId/reference-chart

POST   /api/events/:eventId/maps/:mapId/validate
POST   /api/events/:eventId/maps/:mapId/publish
GET    /api/events/:eventId/maps/:mapId/versions/:versionId

GET    /api/events/:eventId/maps/:mapId/commercial-assignments
PUT    /api/events/:eventId/maps/:mapId/commercial-assignments
```

Casos de uso explícitos:

- `CreateEventMapDraft`;
- `LoadEventMapDraft`;
- `UpdateEventMapDocument`;
- `UpdateMapReferenceChart`;
- `ValidateEventMapDraft`;
- `CreatePublishedMapVersion`;
- `AssignMapCommercialRules`;
- `DuplicateEventMap`.

O `POST /maps` recebe apenas a intenção de criação (`blank` ou
`reference-plan`) e metadata mínima. O documento inicial é criado pelo domínio.

Todas as operações carregam por `contaId + eventId + mapId`, usam transação
quando houver múltiplas escritas e retornam erros estáveis sem stack trace ou
detalhes internos.

## 9. Publicação e persistência

Publicar não é um `PATCH` comum:

```text
draft
→ resolver geometrias e identificações
→ validar invariantes
→ criar snapshot imutável
→ materializar inventário
→ associar publishedVersionId
```

O comprador lê o snapshot publicado. Alterações posteriores no draft não
alteram uma versão pública, reserva, pedido ou ticket existente.

Toda entidade tenant-scoped deve possuir `contaId`, relação com `Conta`, índices
adequados e filtros compostos. Nenhuma consulta sensível pode depender apenas
de um ID global.

Migrations devem seguir expand/backfill/switch/contract. Não editar migration
aplicada. A remoção de tabelas, enums, relações ou campos antigos ocorre apenas
após migração, verificação de consumidores e janela de segurança.

## 10. Remoção do legado

Antes de apagar arquivos, fazer inventário com `rg` para:

- `EventSeatGroup`, `SeatGroup` e `SeatGrid`;
- corredores inteligentes, collision, push e reflow;
- handlers e adapters geométricos duplicados;
- listas de assentos paralelas ao documento;
- aliases de API e payloads antigos;
- inspectors que misturam níveis da hierarquia;
- testes mortos ou gerados que validam o comportamento abandonado.

Classificar cada ocorrência como `migrar`, `substituir`, `remover`,
`compatibilidade temporária` ou `não relacionada`.

Sequência de corte:

1. congelar novas funcionalidades no modelo antigo;
2. versionar o documento canônico;
3. manter migrator isolado em `packages/domain/src/map-engine/migrations`;
4. mudar leitores para o documento canônico;
5. mudar escritas para comandos canônicos;
6. comparar IDs, contagens e snapshots em staging;
7. confirmar consumidores ativos do legado iguais a zero;
8. remover arquivos, imports, rotas e testes mortos;
9. remover a compatibilidade temporária em migration posterior;
10. remover a feature flag antiga.

O workspace final não deve manter dois modelos oficiais.

## 11. Fases de implementação

### Fase 0 — contratos e inventário

- congelar novas abstrações de corredor/reflow;
- fechar schema versionado, seleção, paths e comandos;
- mapear consumidores da API atual;
- definir feature flags e rollback;
- registrar a matriz `migrar/substituir/remover`.

**Saída:** contrato canônico e plano de migração verificável.

### Fase 1 — entrada no creator

- implementar a página “Em branco / Importar planta”;
- manter “Usar mapa existente” separado;
- criar draft pelos casos de uso;
- conectar upload e referência;
- aplicar Hugeicons ao fluxo de entrada.

**Saída:** o usuário entra no editor pelo fluxo correto.

### Fase 2 — bloco como unidade principal

- criar `SeatBlock` por drag;
- usar preview efêmero e commit único;
- implementar inspector contextual;
- derivar totais do documento;
- persistir IDs estáveis.

**Saída:** uma plateia simples é criada sem formulário técnico.

### Fase 3 — geometria paramétrica

- consolidar os quatro paths no engine puro;
- implementar `FIXED`, `PROGRESSIVE` e `FIT`;
- implementar gaps locais e overrides;
- aplicar curvatura por slider;
- implementar transforms locais e orientação explícita para palco;
- usar calibração como default de novos blocos.

**Saída:** blocos retos, curvos, abertos e segmentados são determinísticos.

### Fase 4 — hierarquia e proteção operacional

- unificar seleção entre árvore, canvas, inspector e transformer;
- implementar entrada/saída de níveis;
- emitir exclusões apenas por comandos de domínio;
- impedir redução de assentos protegidos;
- garantir undo/redo de subárvores.

**Saída:** não existe exclusão parcial nem divergência estrutural.

### Fase 5 — identificação

- separar tabs Layout e Identificação;
- numerar em relação ao path;
- definir primeira fileira pela proximidade do palco;
- suportar direção início → fim;
- validar identificadores únicos;
- exibir breadcrumb de contexto.

**Saída:** mapas diagonais, invertidos e com palco lateral continuam claros.

### Fase 6 — configuração comercial

- separar modos de construção e venda;
- implementar assignments e precedência;
- exibir lugares sem ticket e conflitos;
- preservar histórico operacional.

**Saída:** preço e inventário não ficam misturados à geometria.

### Fase 7 — revisão, preview e publicação

- implementar checklist e navegação “mostrar no mapa”;
- criar preview do comprador sem ferramentas de autoria;
- validar no servidor;
- criar snapshot imutável;
- materializar inventário idempotentemente;
- validar edição posterior do draft.

**Saída:** publicação reproduzível, auditável e segura.

### Fase 8 — limpeza final

- remover arquivos, imports, rotas e testes mortos;
- migrar todos os componentes do creator para o adapter Hugeicons;
- revisar limites de pacotes e nomenclatura;
- atualizar runbooks;
- confirmar ausência de referências ao legado com `rg`.

**Saída:** existe uma única arquitetura ativa no workspace.

## 12. Matriz de testes

### Domínio

- criação de bloco;
- distribuição fixa, progressiva e fit;
- arredondamento determinístico;
- line, arc, polyline e Bézier;
- gaps, transforms e orientação para palco;
- numbering independente da posição visual;
- preservação de IDs e overrides;
- migração de documento antigo;
- overlap, limites e duplicidade.

### API e banco

- autenticação e autorização;
- isolamento entre duas `contaId`;
- acesso a `eventId/mapId` de outro tenant;
- payload inválido e erros estáveis;
- retry idempotente de publicação;
- ownership da planta de referência;
- falha intermediária de transação;
- migration em banco de teste.

### E2E

- criar mapa em branco;
- criar mapa importando planta;
- calibrar, bloquear, ocultar e editar referência;
- criar bloco arrastando;
- entrar no bloco e editar fileira/assento;
- Escape para subir na hierarquia;
- excluir e desfazer bloco;
- bloquear redução de assento protegido;
- atribuir ingresso e revisar;
- abrir preview comprador;
- publicar e reabrir draft sem alterar a versão pública.

## 13. Critérios de aceite

A refatoração está concluída quando:

- o usuário entra no creator pela página de decisão correta;
- arrastar cria um `SeatBlock` persistido e editável;
- seção, bloco, fileira e assento têm uma hierarquia única;
- todos os contadores derivam do mesmo documento;
- geometria é determinística e não possui reflow implícito;
- o palco não move blocos automaticamente;
- a planta de referência não é publicada;
- construção e venda são modos separados;
- publicação cria snapshot imutável e inventário consistente;
- toda operação respeita `contaId` e autorização;
- assentos protegidos não são apagados silenciosamente;
- o creator usa Hugeicons por adapter semântico;
- não existem arquivos ou testes mortos do modelo antigo;
- typecheck, testes, Prisma e validação de tenant estão verdes.

## 14. Próximo lote recomendado

1. implementar a página pré-editor “Em branco / Importar planta”;
2. fechar o contrato de `EventMapDocument` e dos comandos;
3. substituir o fluxo de criação atual por `SeatBlock` criado por drag;
4. unificar seleção, inspector e exclusão hierárquica;
5. adicionar distribuição progressiva/fit e gaps locais;
6. criar modo comercial e revisão;
7. implementar publicação por snapshot;
8. migrar os ícones do creator para Hugeicons;
9. remover definitivamente o legado após confirmar consumidores zero.

Cada lote deve ser pequeno, testável e revisado antes do seguinte. Nenhuma
etapa deve introduzir novamente estado geométrico implícito ou duplicar a fonte
de verdade.

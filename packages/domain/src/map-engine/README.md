# Map Engine

Engine canonica do Map Creator.

## Responsabilidades

- Manter regras puras de documento, comandos, historico, layout, geometria, selecao e validacao.
- Receber dependencias externas apenas por ports/runtime quando necessario.
- Retornar patches/estado canonico para que o app sincronize canvas, painel e historico pelo mesmo commit.

## Fronteiras

- Nao importar React, Konva, DOM, browser APIs, storage ou renderer real.
- Nao chamar `Date.now`, `Math.random` ou `crypto` diretamente.
- Canvas/Konva, preview visual, medicao real de texto e browser storage ficam em `apps/web/features/events/map`.

## Camadas de transform

```txt
packages/domain/src/map-engine/
  geometry/
    bounds.ts, anchor.ts, hit-test.ts
    rotation.ts, translation.ts, scale.ts, transform-compose.ts
    snap-guides.ts, resize-snap-guides.ts, ...
  layout/
    object-bounds.ts, text-transform.ts, seat-group-transform.ts
    corridor/                    # reflow, previews, split-anchors, extract-commit
    corridor-rotation.ts, corridor-group-*.ts, ...
  commands/transform-commands.ts   # classifyTransformPayload (ROTATE/MOVE/RESIZE)
  reducer/
    map-command-reducer.ts         # router + normalizeMapCommand
    handlers/                      # add-entities, update-items, seat-group, corridor, selection

apps/web/.../map/canvas/
  adapters/
    konva-transform-adapter.ts, konva-bounds-adapter.ts, konva-text-adapter.ts
  commit/*                       # Konva → patch → classifyTransformPayload → store
```

**Regra:** se funciona sem Konva → `map-engine`. Se precisa de `node.rotation()` → `canvas/adapters`.

## Fluxo Esperado

```txt
evento visual -> adapter/session canvas -> preview temporario -> comando/store -> map-engine -> resync visual
```

O documento retornado pela engine e a fonte da verdade apos cada commit.

## Store (web)

Transform commits (transform, drag, resize) usam commands semanticos via `applyTransform`:

- `TRANSFORM_CORRIDOR` — corredor + reflow (transform e drag)
- `ROTATE_OBJECTS` — rotacao pura de objetos/assentos
- `MOVE_OBJECTS` — translacao pura (drag generico)
- `RESIZE_OBJECTS` — escala, texto, seat groups e patches mistos

Geometria E2E: `e2e/event-map-e2e-geometry.ts` (`buildEventMapE2EGeometry`).
Bridge browser: `apps/web/.../browser/event-map-e2e-bridge.ts`.

## Imports recomendados

```typescript
import { normalizeRotation, rotatePoint } from '@alusa/domain';
import { buildCorridorGroupRotationUpdates } from '@alusa/domain';
import { corridorPatchesToDomainOperations } from '@alusa/domain';
```

Barrel semantico: `@alusa/domain` re-exporta `map-engine/transform/index.js`.

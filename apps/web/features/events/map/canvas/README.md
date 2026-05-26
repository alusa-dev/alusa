# Canvas runtime (Konva)

Camada de execução visual do Map Creator. **Não contém matemática de transform** — isso vive em `@alusa/domain` (`map-engine`).

## Pastas

| Pasta | Papel |
|---|---|
| `adapters/` | Leitura/escrita Konva (transform, snap, polygon points) |
| `commit/` | Konva node → MapCommand → `applyTransform` |
| `corridor/` | Sync corredor, sessions de transform, preview |
| `render/` | Modelo de render, aparência, drafts |
| `sessions/` | Hooks React (drag, transform, selection, viewport, snap guides) |
| `transform/` | Routing e `map-transform-session` |
| `__tests__/` | Testes de integração Konva (sem DB) |

## Fluxo de transform e drag

```txt
Transformer / drag end
  → commit/* (buildObjectTransformCommit | buildSeatGroupTransformCommit | buildGroupDragCommit)
  → applyCanvasTransformPayload / applyCanvasTransformCommit
  → buildCanvasTransformCommand (ROTATE | MOVE | RESIZE | TRANSFORM_CORRIDOR)
  → @alusa/domain executeMapCommand
  → resync corridor nodes
```

Seleção única via transformer, multi-select via `use-transform-session`, e drag de grupo via `buildGroupDragCommit` — todos passam pelo mesmo path semântico.

## Fluxo de transform (multi-select)

```txt
Transformer event
  → sessions/use-transform-session
  → transform/map-transform-session + corridor/corridor-transform-session
  → adapters/konva-transform-adapter (preview)
  → store.applyTransform(ROTATE | MOVE | RESIZE | TRANSFORM_CORRIDOR)
  → @alusa/domain executeMapCommand
  → resync corridor nodes
```

## Imports

```typescript
// ✅ Konva
import { readObjectTransformCommitFromNodes } from '../adapters/konva-transform-adapter';

// ✅ Domain
import { buildCorridorGroupRotationUpdates } from '@alusa/domain';

// ❌ Trigonometria / resize math no canvas
```

## Testes

```bash
MAP_CANVAS_UNIT=1 pnpm test:unit:map-canvas
```

Inclui testes Konva em `canvas/__tests__` e integração de store in-memory em `store/__tests__/corridor-group-transform-store.test.ts`. Não requer `DATABASE_URL` de teste.

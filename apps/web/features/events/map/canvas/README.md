# Canvas runtime (Konva)

Camada de execução visual do Map Creator. **Não contém matemática de transform** — isso vive em `@alusa/domain` (`map-engine`).

## Pastas

| Pasta | Papel |
|---|---|
| `adapters/` | Leitura/escrita Konva (transform, snap, polygon points) |
| `commit/` | Konva node → MapCommand → `applyTransform` |
| `render/` | Modelo de render, aparência, drafts |
| `sessions/` | Hooks React (drag, transform, selection, viewport, snap guides) |
| `transform/` | Routing e `map-transform-session` |
| `__tests__/` | Testes de integração Konva (sem DB) |

## Fluxo de transform e drag

```txt
Transformer / drag end
  → commit/* (buildObjectTransformCommit | buildGroupDragCommit)
  → applyCanvasTransformPayload / applyCanvasTransformCommit
  → buildCanvasTransformCommand (ROTATE_SELECTION | MOVE_SELECTION/MOVE_OBJECTS | RESIZE_SELECTION/RESIZE_OBJECTS)
  → @alusa/domain executeMapCommand
```

Seleção única via transformer, multi-select e arraste de múltiplos elementos passam pelo mesmo path semântico.

## Fluxo de transform (multi-select)

```txt
Transformer event
  → sessions/use-transform-session
  → transform/map-transform-session
  → adapters/konva-transform-adapter (preview)
  → store.applyTransform(ROTATE_SELECTION | MOVE_SELECTION/MOVE_OBJECTS | RESIZE_SELECTION/RESIZE_OBJECTS)
  → @alusa/domain executeMapCommand
```

## Imports

```typescript
// ✅ Konva
import { readObjectTransformCommitFromNodes } from '../adapters/konva-transform-adapter';

// ✅ Domain

// ❌ Trigonometria / resize math no canvas
```

## Testes

```bash
MAP_CANVAS_UNIT=1 pnpm test:unit:map-canvas
```

Inclui testes Konva em `canvas/__tests__` e integração de store in-memory em `store/__tests__`. Não requer `DATABASE_URL` de teste.

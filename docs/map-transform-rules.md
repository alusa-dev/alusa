# Map transform rules

Editor transform behaviour for the event map canvas (`MapCanvas` + Konva `Transformer`).

## Selection routing

| Selection | Pipeline | Behaviour |
|-----------|----------|-----------|
| Single object | Default Konva | Per-object commit via `handleTransformEnd` |
| Multi corridor (no text) | `corridor` | Imperative preview; reflow on commit |
| Multi corridor + text | **blocked** | Handles disabled |
| Multi corridor + seats/sections | **blocked** | Handles disabled |
| Multi text + shapes | `uniform` | Proportional scale from group center |
| Multi shapes only | `generic` | Figma-like uniform scale from union center |

## Corridor handles

| Handle | Multi | `keepRatio` | Preview |
|--------|-------|-------------|---------|
| Edge | 1+ | `false` | Konva scale, no per-frame bake |
| Corner | 1 | `false` | Konva scale |
| Corner | 2+ | `true` | Uniform group scale |
| Rotater | 1 | — | Konva native + 90° snap on commit |
| Rotater | 2+ | — | Orbit around group pivot |

`transformerScaleOptions` React state drives `keepRatio` / `centeredScaling` during active sessions (fixes Konva re-render override).

## Snap

- **Corridors:** 90° rotation snaps; resize snap at commit via `snapCorridorGeometryAtCommit`
- **Other objects:** Shift → 15° rotation; drag/resize snap via `useSnapGuidesSession`
- Snap is disabled on `anchorDragBoundFunc` while a transform pipeline session is active

## Cancel

- **Escape** during transform restores captured node snapshots and skips commit

## Domain bridge

Corridor commits produce domain ops via `corridorPatchesToDomainOperations` (with anchor fidelity). Ops are recorded in the E2E bridge (`getLastCorridorDomainOperations`).

## Files

- `lib/transform-routing.ts` — selection → pipeline
- `lib/transform-handle-mode.ts` — handle → transformer options
- `lib/map-transform-session.ts` — unified session orchestrator
- `lib/corridor-transform-session.ts` — corridor preview + commit
- `lib/generic-group-transform.ts` — multi-shape uniform scale

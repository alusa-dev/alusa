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

## Fluxo Esperado

```txt
evento visual -> adapter/session canvas -> preview temporario -> comando/store -> map-engine -> resync visual
```

O documento retornado pela engine e a fonte da verdade apos cada commit.

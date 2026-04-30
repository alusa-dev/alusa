# Testes e validação

## Objetivo

Registrar como o módulo Aulas foi validado e quais contratos críticos possuem cobertura direta.

## Cobertura validada

### Unitários e domínio

Foram validados contratos como:

- erros de domínio do módulo
- mapeamento de status HTTP por AulasError
- política de janela de frequência
- política de auto-close da agenda
- rotas de agenda, frequência e workspace com escopo de acesso
- integridade de frequência e reposição

Arquivos de teste relevantes:

- apps/web/tests/unit/aulas.domain.test.ts
- apps/web/tests/unit/attendance-launch.test.ts
- apps/web/tests/unit/aulas.agenda.api.test.ts
- apps/web/tests/unit/aulas.frequencia.api.test.ts
- apps/web/tests/unit/aulas.frequencia.workspace.api.test.ts
- apps/web/tests/unit/aulas.reposicoes.api.test.ts
- apps/web/tests/unit/aulas.agenda.operations.api.test.ts
- apps/web/tests/unit/aulas.calendar-core.test.ts
- apps/web/src/server/aulas/agenda/agenda-event-auto-close.service.test.ts

## E2E real validado

Arquivo principal:

- apps/web/e2e/aulas-flow.spec.ts

Fluxos cobertos:

- criar evento na agenda, registrar frequência e validar sincronização na frequência
- criar reposição com evento destino existente e concluir o fluxo

## Comandos usados

Unitários do módulo web:

```bash
pnpm --filter @alusa/web test:unit
```

Typecheck relevante:

```bash
pnpm -w -s -C apps/web typecheck
pnpm -w -s -C packages/lib typecheck
```

Playwright do fluxo principal:

```bash
pnpm --filter @alusa/web exec playwright test e2e/aulas-flow.spec.ts --project=chromium
```

## Regressões reais que foram fechadas

- contrato quebrado do input de data e hora no modal de agenda
- heading duplicado na página de reposições
- CTA de frequência exposto em cenário que o backend bloqueava
- validação final do fluxo E2E alinhada ao contrato real da tela de frequência

## Estado final da validação

- testes unitários relevantes: verdes
- Playwright do fluxo principal: verde
- módulo considerado fechado para o escopo auditado e implementado

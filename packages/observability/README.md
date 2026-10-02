# `@alusa/observability`

Pacote compartilhado e neutro de fornecedor para contratos e utilitários de observabilidade usados pelos apps e packages da Alusa.

## Ownership

Este pacote é responsável por:

- logs estruturados e contexto técnico comum;
- parsing e formatação de contexto W3C `traceparent`;
- normalização de nomes de rota, métodos HTTP e dimensões de métricas;
- redaction de valores sensíveis e filtragem por allowlist;
- contratos de telemetria e um sink substituível.

Os adapters de Sentry e configurações específicas de cada runtime pertencem ao app correspondente, em `apps/web`, `apps/admin` e `apps/mobile`. Semântica financeira, de jobs e de integrações permanece nos packages de domínio responsáveis, que podem emitir eventos técnicos por estes contratos.

## Limites de arquitetura

- Não importar Next.js, Expo, Prisma, Sentry ou módulos de `apps/*`.
- Não incluir regras de negócio, persistência de telemetria ou acesso ao banco.
- Não enviar `contaId`, usuário, aluno, responsável, pagamento, identificadores externos ou outros dados pessoais como dimensões globais de métrica.
- Manter dimensões de métricas de baixa cardinalidade e atributos allowlisted.
- Não tratar telemetria como trilha de auditoria nem como fonte de verdade financeira ou acadêmica.
- Usar os exports públicos de `@alusa/observability`; mudanças de contrato devem preservar compatibilidade dos consumidores.

## Módulos

| Módulo | Responsabilidade |
|---|---|
| `context` | Contexto técnico e headers W3C `traceparent` |
| `logging` | Construção de logs estruturados |
| `metrics` | Normalização de dimensões HTTP e métricas |
| `redaction` | Remoção de dados sensíveis e allowlists |
| `telemetry` | Interface neutra e registro substituível de sink |
| `tracing` | Convenções para nomes de spans HTTP e operações |

## Validação

Use os comandos do pacote a partir da raiz do monorepo:

```bash
pnpm --filter @alusa/observability typecheck
pnpm --filter @alusa/observability test
```

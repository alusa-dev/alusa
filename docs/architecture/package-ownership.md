# Ownership de pacotes e fronteiras

Este mapa evita que `packages/lib` vire uma nova camada genérica. O pacote que
possui uma regra também possui seus contratos, testes e decisão de migração.

| Área | Fonte de verdade | Pode depender de | Não deve conter |
| --- | --- | --- | --- |
| Domínio acadêmico | `packages/domain` | `shared` | Prisma, Next.js, Asaas, HTTP |
| Casos financeiros | `packages/finance` | `domain`, `database`, `asaas`, `asaas-gateway`, `shared` | UI, sessão HTTP, `contaId` vindo do client |
| Cliente Asaas | `packages/asaas` | tipos e HTTP | Prisma, Alusa, tenant, regras de negócio |
| Gateway/contratos Asaas | `packages/asaas-gateway` | `asaas`, `shared` | telas, acesso direto a banco |
| Persistência | `packages/database` | Prisma e tipos compartilhados | Next.js route handlers, regras de UI |
| Tipos sem infraestrutura | `packages/shared` | bibliotecas puras | Prisma, Next.js, providers externos |
| Billing da plataforma | `packages/platform-billing` | Stripe e database | regras de cobrança escolar do Asaas |
| API/BFF | `apps/web/app/api` | contexto HTTP e casos de uso | regra financeira/acadêmica complexa, Prisma novo |
| UI compartilhada | `packages/ui` | React e acessibilidade | sessão, Prisma, Asaas |

## Regra para `packages/lib`

Utilitários puros reutilizados por Web, Finance e Mobile pertencem a
`packages/shared`. Atualmente CPF/CNPJ (`validators/cpf-cnpj`) e calendário
acadêmico (`date-only`) já possuem implementação canônica nesse pacote;
`packages/lib` conserva apenas reexports de transição.

`packages/lib` permanece compatível durante a migração, mas novos arquivos só
entram ali quando forem realmente cross-cutting e tiverem owner declarado. Uma
regra de domínio deve ir para `packages/domain`; uma operação financeira para
`packages/finance`; repository para `packages/database`; contrato de entrada ou
saída para o bounded context que o consome.

O gate `pnpm audit:lib-boundaries` impede imports do barrel em runtime. A
decomposição adicional deve ser feita por subpath, com testes e telemetria de
uso antes de remover exports legados.

O gate `pnpm audit:package-graph` gera
[`package-dependency-graph.json`](./package-dependency-graph.json), bloqueia
ciclos e dependências proibidas e exige que imports runtime entre packages
estejam declarados. A ponte temporária `@alusa/lib → @alusa/finance` é a única
exceção registrada; ela existe para manter compatibilidade durante a extração
do bounded context de alunos e deve desaparecer antes da remoção do legado.

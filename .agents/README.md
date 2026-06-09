# Agentes Alusa

Contratos canônicos de especialistas de IA para o monorepo Alusa.

## Como usar

| Ferramenta | Como invocar |
|------------|--------------|
| **Cursor** | Skill `alusa` / `#alusa` · `core` / `#core` · `tenant` / `#tenant` · `asaas` / `#asaas` · `finance-sync` / `#finance-sync` |
| **Copilot** | `@Alusa Product Context` · `@Alusa Core` · `@Multitenancy Isolation` · `@Asaas MCP Specialist` · `@Financial Sync Specialist` |
| **Qualquer** | “Siga `.agents/alusa.md`”, `.agents/core.md`, `.agents/tenant.md`, `.agents/asaas.md` ou `.agents/finance-sync.md` |

## Mapa de agentes

| ID | Arquivo | Pergunta que responde | Trigger |
|----|---------|----------------------|---------|
| **alusa** | [alusa.md](./alusa.md) | Isso faz sentido no produto? Qual domínio? | `#alusa`, escopo, visão |
| **core** | [core.md](./core.md) | Como implementar com segurança? | `#core`, dev, refactor, UI, API |
| **tenant** | [tenant.md](./tenant.md) | Está isolado no `contaId`? RLS, portal, cache | `#tenant`, RLS, cross-tenant |
| **asaas** | [asaas.md](./asaas.md) | Contrato Asaas, webhook, MCP, cobrança? | `#asaas`, subconta, payment |
| **finance-sync** | [finance-sync.md](./finance-sync.md) | Alteração na Alusa reflete no Asaas e reconcilia? | `#finance-sync`, outbound sync, edição financeira |

## Camadas

```txt
alusa (produto — o quê / por quê)
  → core (implementação universal)
  → tenant | asaas | finance-sync | … (especialistas técnicos)
```

## Hierarquia de fonte de verdade

1. Código + testes
2. `AGENTS.md`, `.github/instructions/`, `.agents/`
3. `packages/*`, `apps/web/features/*`
4. MCP Asaas (contrato externo)

## Relacionados

- Regras universais de código: [AGENTS.md](../AGENTS.md) · [core.md](./core.md)
- Isolamento tenant: [tenant.md](./tenant.md)
- Integração Asaas: [asaas.md](./asaas.md)
- Sincronização financeira outbound: [finance-sync.md](./finance-sync.md)
- Skills Cursor: `.cursor/skills/`
- Adaptadores Copilot: `.github/agents/`

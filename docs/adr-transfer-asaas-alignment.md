# ADR: Alinhamento de transferências (Pix / TED) com Asaas

## Contexto

A feature Meu Dinheiro solicita saques via `POST /v3/transfers` (Pix por chave ou conta bancária). A documentação Asaas define normalização de chaves, campos condicionais, modalidade automática (Pix vs TED) e taxas.

## Decisões

### D1 — Conta bancária: modalidade automática

**Decisão:** omitir `operationType` em transferências para conta bancária e persistir/exibir a modalidade retornada pelo Asaas (`operationType` na resposta).

**Motivo:** alinhamento com a doc oficial; liquidação Pix quando o banco participa do arranjo.

### D2 — `ownerBirthDate`

**Decisão:** exigir data de nascimento quando o favorecido é **PF (CPF)** e o documento difere do CPF/CNPJ da conta Asaas do tenant.

**Motivo:** requisito Asaas para titular terceiro.

### D3 — Taxa no wizard e validação de saldo

**Decisão:** exibir taxa estimada via `getTransferFees` e bloquear solicitações em que `valor + taxa estimada > saldo disponível`.

**Motivo:** evitar falhas genéricas no Asaas; estimativa conservadora.

### D4 — Normalização canônica

**Decisão:** módulo único `asaas-transfer-payload.ts` normaliza payload antes do POST e alimenta idempotência/integridade.

### D5 — Cancelamento

**Decisão:** UI usa `canBeCancelled` do GET Asaas (fallback `status === PENDING`).

## Fora de escopo imediato

- Pix recorrente (`recurring`)
- Campos avançados `agencyDigit` / `ispb` na UI (salvo demanda operacional)
- Descrição em TED: mantida no payload; Asaas pode ignorar

## Referências

- [Transferência Pix/TED — Asaas](https://docs.asaas.com/docs/transferencia-para-contas-de-outra-instituicao-pix-ted)
- `POST /v3/transfers` — OpenAPI via MCP Asaas

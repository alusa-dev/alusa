# ADR — Endereço do responsável financeiro e customer Asaas

## Contexto

A emissão de NFS-e no Asaas exige **customer com endereço completo e CEP válido** (`POST/PUT /v3/customers` — campos `postalCode`, `addressNumber`, `address`, `province`, etc.).

A Alusa tinha fluxos divergentes:

- Wizard de aluno menor pedia CEP, mas descartava endereço sem número.
- Criação isolada de responsável não coletava endereço.
- Edição no detalhe persistia no Prisma, mas **não sincronizava** o customer Asaas.

## Decisão

1. **Contrato canônico** em `packages/lib/src/responsaveis/payer-address.ts`:
   - CEP (8 dígitos, não repetido), número, logradouro, bairro, cidade, UF.
2. **Responsável financeiro** deve ter endereço completo antes de:
   - cadastro via wizard / POST responsável (quando `financeiro`),
   - emissão de NFS-e (`scheduleChargeInvoice` faz pre-sync).
3. **Sync centralizado** via `syncResponsavelAsaasCustomer` → `ensureAsaasCustomerForPayer` (PUT `/v3/customers/{id}` conforme doc Asaas).
4. **Recovery**: PATCH responsável dispara sync; job `reconcile-responsavel-customer-addresses` repete sync para endereços completos no banco.

## Consequências

- Cadastros incompletos passam a falhar com erro explícito (400), não silenciosamente.
- Correção de endereço no detalhe do responsável atualiza o Asaas antes de retentar NF.
- UI compartilhada (`ResponsavelEnderecoFields`) unifica wizard, modal e detalhe.

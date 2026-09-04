# Cálculo financeiro de Eventos

## Fonte canônica

Toda inscrição com valor possui uma obrigação financeira local. A cobrança
Asaas, boleto, PIX ou cartão representa apenas o canal de pagamento; não é uma
segunda receita.

```text
valor bruto - desconto = valor líquido esperado
pagamentos recebidos - estornos = receita realizada líquida
```

Inscrições antigas sem `EventFinancialEntry` continuam compondo a previsão pelo
vínculo com o participante. Receitas manuais históricas de categoria `Taxa de
inscrição` sem `originId` são mantidas na fila de reconciliação e excluídas do
agregado quando as obrigações dos participantes estão disponíveis, evitando
dupla contagem.

## Métricas

`receitaPrevista` usa o valor líquido das obrigações ativas, vendas pendentes,
vendas pagas, figurinos cobrados e outras receitas previstas.

`receitaRealizada` usa apenas pagamentos efetivos, abatendo estornos. Uma
inscrição pendente sem pagamento não compõe a receita realizada.

`saldoAReceber` é a diferença não negativa entre a receita prevista e a receita
realizada. Ele representa o que ainda falta receber, não o lucro líquido.

`resultadoPrevisto` é receita prevista menos custos previstos.

`resultadoRealizado` é receita realizada menos custos pagos.

`lucroBruto` desconta somente custos diretos. `lucroLiquido` desconta todos os
custos classificados como diretos, indiretos, financeiros ou tributários.

## Classes de custo

| Classe | Uso |
| --- | --- |
| `DIRECT` | custo diretamente relacionado à execução do evento |
| `INDIRECT` | despesa operacional compartilhada ou administrativa |
| `FINANCIAL` | taxas de gateway, cartão, boleto ou Asaas |
| `TAX` | impostos e retenções |

O custo de figurino vinculado a um lançamento financeiro é previsto quando o
lançamento está pendente e realizado somente quando o lançamento está pago.

## Diagnóstico

O endpoint `GET /api/events/:eventId/financial-consistency` é somente leitura e
compara obrigações dos participantes, descontos e lançamentos vinculados. Ele
não corrige valores automaticamente. Correções financeiras devem preservar a
fonte de verdade do pagamento, auditoria e reconciliação por tenant.

Para materializar lançamentos ausentes de dados legados, existe o script
`scripts/backfill-event-financial-entries.ts`. Ele é dry-run por padrão. O modo
`--apply` exige `--conta-id=<id>` e `--event-id=<id>`, usa uma transação com lock
por evento e identifica cada materialização pela inscrição. O script exige
`--acknowledge-unlinked` quando há receita manual sem vínculo; essas linhas são
preservadas para reconciliação. Divergências em cobrança agrupada continuam
bloqueando a aplicação. O backfill cria somente lançamentos locais e não cria,
atualiza ou consulta cobranças no Asaas.

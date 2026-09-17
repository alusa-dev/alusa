# Convenções HTTP da API Alusa

Este documento define o contrato mínimo para novas APIs e para a modernização
incremental das rotas existentes. A API da Alusa é um BFF de um ERP
Educacional multi-tenant; método e status HTTP precisam refletir a operação de
negócio sem substituir as regras de domínio.

## Métodos

| Método | Uso obrigatório | Observação |
| --- | --- | --- |
| `GET` | Leitura sem efeitos colaterais | Não altera matrícula, cobrança, contrato ou estado financeiro. |
| `POST` | Criação ou comando de negócio | Usado para matrícula, estorno, cancelamento, reconciliação e webhooks quando a operação não é uma simples substituição de recurso. |
| `PUT` | Substituição completa de uma representação | Deve validar o payload completo. Não usar para atualizações parciais. |
| `PATCH` | Alteração parcial | Deve validar apenas os campos permitidos e aplicar autorização específica. |
| `DELETE` | Remoção/inativação de recurso | Em dados financeiros, acadêmicos e auditáveis, preferir cancelamento/inativação e preservação do histórico. |
| `HEAD`/`OPTIONS` | Compatibilidade HTTP | `HEAD` acompanha `GET`; `OPTIONS` deve refletir os métodos permitidos quando explicitamente implementado. |

A URL deve representar um recurso. Ações de domínio usam um sufixo explícito,
por exemplo `/api/cobrancas/:id/refund` e `/api/matriculas/:id/cancelamento`.
Não transformar um `GET` em comando apenas para facilitar o frontend.

## Status de sucesso

| Status | Quando usar |
| --- | --- |
| `200 OK` | Leitura concluída ou comando síncrono concluído com representação retornada. |
| `201 Created` | Recurso criado e persistido; incluir a representação criada quando possível. |
| `202 Accepted` | Comando aceito para processamento assíncrono; incluir identificador de operação e estado observável. |
| `204 No Content` | Sucesso sem corpo de resposta. Não enviar JSON vazio. |

Uma operação financeira que depende de webhook ou fila deve retornar `202`,
quando o estado ainda não estiver confirmado. O webhook do Asaas pode retornar
`200` quando o evento foi recebido e persistido/aceito; isso não significa que
um pagamento esteja liquidado.

## Status de erro

| Status | Uso na Alusa |
| --- | --- |
| `400` | JSON, parâmetros, headers ou formato da requisição inválidos. |
| `401` | Sessão ou credencial ausente/inválida. |
| `403` | Usuário autenticado sem permissão ou tentando acessar outro tenant. |
| `404` | Recurso inexistente no `contaId` autorizado. Não revelar se existe em outro tenant. |
| `409` | Conflito de estado, duplicidade ou operação concorrente. |
| `412` | Pré-condição do fluxo não atendida, como conta financeira ainda não habilitada. |
| `413` | Payload acima do limite. |
| `415` | `Content-Type` não suportado. |
| `422` | Payload bem formado, mas inválido para a regra de negócio. |
| `429` | Limite de requisições excedido; incluir `Retry-After` quando aplicável. |
| `500` | Falha inesperada interna; nunca expor stack trace, SQL, token ou mensagem do provedor. |
| `502` | Falha ou resposta inválida de integração externa. |
| `503` | Serviço ou integração temporariamente indisponível. |

## Formato de resposta

Novas rotas devem preferir:

```json
{
  "data": {},
  "meta": {}
}
```

Para erros, usar o helper `apiJsonError`:

```json
{
  "error": {
    "code": "MATRICULA_NAO_ENCONTRADA",
    "message": "Matrícula não encontrada.",
    "details": {}
  }
}
```

`details` deve conter apenas dados seguros e necessários para o frontend. Em
respostas 5xx, a mensagem pública é fixa e a investigação deve usar logs
estruturados com `correlationId`.

Rotas legadas podem manter o payload já consumido pelo frontend durante a
migração, mas devem preservar o status correto, `cache-control: no-store` para
dados sensíveis e códigos estáveis. A compatibilidade deve ser registrada no
inventário, não reproduzida em novas rotas.

## Checklist obrigatório antes do merge

- [ ] O método corresponde à operação e não possui efeitos colaterais ocultos.
- [ ] `contaId` vem da sessão/escopo autorizado, nunca de confiança cega no client.
- [ ] Body, query, params e headers foram validados com Zod quando aplicável.
- [ ] O sucesso usa `200`, `201`, `202` ou `204` de acordo com o estado real.
- [ ] Conflitos, regras inválidas e indisponibilidade externa possuem status distinto.
- [ ] O corpo de erro possui código estável e não expõe detalhes internos.
- [ ] Mutação financeira possui idempotência, auditoria e correlação.
- [ ] Há teste para autenticação, autorização/tenant, validação, sucesso e falha principal.
- [ ] `pnpm audit:http-contracts` foi executado e passou.
- [ ] A classe de rate limiting da rota foi definida ou a exceção foi documentada.
- [ ] Respostas `429` incluem `Retry-After` e o código `RATE_LIMITED`.

As exceções de compatibilidade são aceitas somente quando documentadas e
protegidas por teste. O objetivo é modernizar sem quebrar os fluxos de alunos,
matrículas, contratos, cobranças, webhooks e portal.

## Rate limiting e proteção contra abuso

Rate limiting é uma camada de infraestrutura para conter abuso, bugs e loops
acidentais do frontend. Ele não substitui autorização, validação, idempotência,
transações ou regras de domínio.

As rotas autenticadas da Alusa usam a conta autorizada na sessão e o usuário
como identidade principal. O `contaId` enviado pelo client nunca escolhe o
tenant. IP é uma camada adicional e só é confiável quando
`TRUST_PROXY_HEADERS=true` estiver configurado no ambiente de produção.

Classes padrão:

| Classe | Uso | Falha do Redis |
| --- | --- | --- |
| `authenticated-read` | GETs autenticados comuns | Degradação controlada e observável |
| `mutation` | POST/PUT/PATCH/DELETE não financeiros | Degradação controlada e observável |
| `financial-mutation` | Cobranças, estornos, cancelamentos e financeiro | `503` fail-closed |
| `expensive-operation` | Relatórios, exportações, sincronizações e reconciliações | `503` fail-closed |
| `tenant-admin` | Operações administrativas | `503` fail-closed |

Toda resposta `429` deve conter:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 120
RateLimit-Remaining: 0
RateLimit-Reset: 30
```

O webhook do Asaas é uma exceção operacional importante. O Asaas entrega
eventos com semântica *at least once*, pode reenviar eventos e recomenda
persistir rapidamente, responder `200` depois da persistência e processar as
regras de negócio de forma assíncrona. A Alusa deve manter idempotência pelo
ID do evento, fila/outbox e monitoramento. Um limite não pode causar uma
interrupção desnecessária da fila do provedor.

Referências oficiais: [API Limits do Asaas](https://docs.asaas.com/docs/api-limits-1),
[recebimento de webhooks](https://docs.asaas.com/docs/receive-asaas-events-at-your-webhook-endpoint)
e [idempotência de webhooks](https://docs.asaas.com/docs/how-to-implement-idempotence-in-webhooks).

Ainda não existe API pública de terceiros na Alusa. Por isso, não há quota ou
API key pública implementada agora. O namespace e os contratos devem nascer
separados da API interna para permitir, no futuro, `contaId + integrationId`,
escopos, rotação, revogação e quotas próprias sem reutilizar sessão ou regras
de usuário interno.

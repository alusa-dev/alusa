---
applyTo: 'Instruções (Copilot) — Integração Asaas (API + Webhooks)'
---

# Instruções para Integração Asaas (API + Webhooks)

**Contexto:** Código que cria/atualiza/remove recursos no Asaas (Customer, Payment, Subscription, Transfer etc.) e/ou consome Webhooks do Asaas.

## 1. Fonte da verdade e consistência
- Sucesso só é válido com HTTP 2xx + validação do body retornado (ex.: id, deleted, status).
- Para operações críticas (create/update/delete), preferir confirmação ativa via GET do recurso após a operação (auditoria/reconciliação).

## 2. Webhooks (obrigatório seguir as regras do Asaas)
- Implementar endpoint único para receber eventos e rotear por event (ex.: PAYMENT_CONFIRMED, CUSTOMER_UPDATED).
- Validar header `asaas-access-token`.
- Quando possível, restringir IPs no firewall para aceitar apenas IPs oficiais do Asaas.
- O Asaas espera resposta do webhook por até 10 segundos; responder HTTP 200 o quanto antes.
- Não usar redirecionamento (evitar 3xx).
- Aceitar `Content-Type: application/json`.
- Webhooks do Asaas seguem "at least once"; tratar duplicidade com idempotência (persistir chave do evento/hash do payload + status).
- Se o endpoint falhar 15 vezes consecutivas, a fila pode ser interrompida; garantir estabilidade e monitoramento.

## 3. Pagamentos e mudanças financeiras
- Nunca considerar pagamento “confirmado” apenas pelo retorno de POST /payments.
- O estado final deve ser derivado de webhook de mudança de status (ex.: PAYMENT_CONFIRMED) e/ou GET do pagamento para reconciliação.

## 4. Rate limit e retries na API do Asaas
- Tratar HTTP 429 Too Many Requests com backoff e respeitar headers de limite (ex.: RateLimit-Reset).
- Ajustar concorrência conforme limites documentados.

## 5. Observabilidade e auditoria
- Registrar payload final enviado e resposta (status code + ids relevantes), sem vazar segredos.
- Monitorar webhooks e criar alertas para falhas de comunicação.

## 6. Boas práticas gerais (produção)
- Evitar testes perigosos em produção.
- Seguir práticas gerais do Asaas: monitoramento, idempotência, logs do payload final.
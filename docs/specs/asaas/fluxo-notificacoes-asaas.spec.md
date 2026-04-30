# Fluxo de Notificações — Integração Asaas

## Definições Gerais

- As preferências globais de canais de notificação (WhatsApp, e-mail, SMS) são configuradas em uma tela central (ex: Minha Conta > Notificações ou Configurações > Integrações > Asaas > Notificações).
- Essas preferências são aplicadas automaticamente a todas as novas cobranças criadas.
- O backend é responsável por aplicar as preferências, registrar logs de envio e expor o status para o frontend.

## Detalhes da Cobrança

- Na página de detalhes da cobrança, exibir apenas:
  - Opção de "Reenviar notificações".
  - Log de envio das notificações (sucesso/erro, data/hora, canal).
- Não é possível escolher canais individualmente na tela de detalhes da cobrança; o padrão global será seguido.
- O usuário pode reenviar notificações manualmente por cobrança, sempre com registro de log.

## Boas Práticas

- Preferências globais centralizadas para evitar inconsistências.
- Logs detalhados para rastreabilidade e auditoria.
- Feedback visual claro ao usuário sobre status e tentativas de envio.

---

*Documento gerado automaticamente para referência de fluxo.*


## Implementação no Backend (com Asaas)

### 1. Armazenamento das Preferências Globais

- As preferências de canais (WhatsApp, e-mail, SMS) devem ser salvas em uma tabela/configuração global da conta/empresa.
- Exemplo: `notificacoesPadrao = { email: true, sms: false, whatsapp: true }`

### 2. Aplicação das Preferências ao Criar Cobrança

- Ao criar uma nova cobrança, o backend deve:
  - Ler as preferências globais salvas.
  - Chamar a API do Asaas para criar a cobrança normalmente.
  - Em seguida, usar o endpoint de notificações do Asaas para atualizar os canais desejados para o cliente/cobrança:

#### Exemplo de chamada (PUT /v3/notifications):
```json
{
  "enabled": true,
  "emailEnabledForCustomer": true,
  "smsEnabledForCustomer": false,
  "phoneCallEnabledForCustomer": false,
  "whatsappEnabledForCustomer": true
}
```

- O backend deve garantir que toda cobrança criada tenha as notificações ajustadas conforme o padrão global.

### 3. Reenvio de Notificações

- Ao acionar o reenvio (detalhes da cobrança), o backend deve:
  - Chamar o endpoint de notificação do Asaas para reenviar pelos canais ativos.
  - Registrar o log da tentativa (canal, data/hora, sucesso/erro).

### 4. Consulta de Logs e Status

- O backend deve expor endpoints para o frontend consultar o histórico de envios e status das notificações de cada cobrança.

### 5. Referências da Documentação Oficial Asaas

- [GET /v3/customers/{id}/notifications](https://docs.asaas.com/docs/alterando-notificacoes-de-um-cliente)
- [PUT /v3/notifications](https://docs.asaas.com/docs/alterando-notificacoes-de-um-cliente)
- [POST /v3/notifications/{id}](https://docs.asaas.com/docs/alterando-notificacoes-de-um-cliente)

---


## Notificações Internas para o Gestor (Sistema Alusa)

- O backend deve possuir um endpoint para receber webhooks do Asaas (ex: `/api/webhooks/asaas`).
- Ao receber eventos como `PAYMENT_RECEIVED`, o backend:
  - Atualiza o status da cobrança no banco de dados.
  - Cria um registro de notificação interna (ex: tabela `notificacoes`) com tipo, referência da cobrança, data/hora, mensagem e usuário relacionado.
- O frontend poderá, futuramente, consumir um endpoint (ex: `/api/notificacoes`) para exibir essas notificações no header ou painel.
- Mesmo sem o componente visual pronto, o backend já pode registrar e expor essas notificações, garantindo rastreabilidade e preparando o sistema para evolução.

**Exemplo de fluxo:**
1. Cliente paga a mensalidade.
2. Asaas envia webhook para o backend.
3. Backend atualiza cobrança e registra notificação interna.
4. Quando o frontend implementar o header de notificações, basta consumir o endpoint e exibir os avisos ao gestor.

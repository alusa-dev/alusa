# Runbook — divergência fiscal NFSe

> Referência completa da feature: [fiscal-nfse-feature.md](../fiscal-nfse-feature.md)

Este runbook cobre divergências entre a configuração/emissão fiscal local da Alusa e o estado oficial do Asaas.

## Sinais

- `ContaFiscalSettings.syncStatus = DIVERGED` ou `PENDING` por muito tempo.
- Tela `Configurações > Nota fiscal` mostra divergência ou erro em `lastSyncError`.
- Webhook `INVOICE_*` chegou para uma cobrança sem `Invoice` local.
- Cobrança de assinatura recebeu pagamento, mas não há nota local após o webhook do Asaas.

## Reconciliação de configuração fiscal

1. Confirmar a `contaId` afetada.
2. Executar sync manual na tela de Nota Fiscal ou chamar:

```bash
curl -X POST "https://<host>/api/jobs/reconcile-fiscal-settings?contaId=<contaId>" \
  -H "x-cron-token: <CRON_SECRET_TOKEN>"
```

3. Verificar se `syncStatus` voltou para `SYNCED` e se `lastSyncError` foi limpo.
4. Conferir o audit log `finance.fiscal.settings.synced`.

Para recuperação em lote, o cron pode chamar sem `contaId`; o job processa apenas contas `PENDING` ou `DIVERGED`:

```bash
curl -X POST "https://<host>/api/jobs/reconcile-fiscal-settings?maxAccounts=20" \
  -H "x-cron-token: <CRON_SECRET_TOKEN>"
```

## Reconciliação de nota fiscal por cobrança

1. Abrir detalhes da cobrança.
2. Usar a ação de sincronização da nota fiscal.
3. Se a nota foi emitida pelo Asaas em assinatura, aguardar ou reprocessar o webhook `INVOICE_*`.
4. Confirmar se a `Invoice` local foi criada/atualizada e ligada à `Charge`.

## Assinaturas

- Assinaturas com `emissionMode = ON_PAYMENT` e `asaasInvoiceSettingsConfigured = true` devem ser emitidas pelo Asaas.
- O webhook de pagamento da Alusa deve retornar skip `SUBSCRIPTION_NATIVE_EMISSION`, sem chamar `emitChargeInvoice`.
- Se `fiscalInvoiceSettingsError` estiver preenchido na assinatura, revalidar configuração fiscal e reenviar `invoiceSettings`.

## Quando escalar

Escalar para engenharia se:

- O sync retorna `CREDENCIAIS_ASAAS_NAO_CONFIGURADAS`, mas a subconta deveria estar ativa.
- `municipalOptions` não carrega repetidamente e a conta fica bloqueada em readiness.
- O Asaas mostra NFSe autorizada, mas a Alusa não consegue resolver a cobrança pelo `payment`.
- Há suspeita de dupla emissão.

Não alterar manualmente status financeiro/fiscal no banco sem registrar causa, `contaId`, cobrança/assinatura afetada e evidência do estado oficial no Asaas.

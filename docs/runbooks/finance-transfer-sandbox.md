# Runbook: testar transferências no sandbox Asaas

## Pix

1. Use chaves fictícias do BACEN (doc Asaas) ou chaves de outra subconta sandbox.
2. Chaves CPF/CNPJ devem ir **sem pontuação**; telefone com **11 dígitos (DDD + número)**.
3. A Alusa normaliza o payload antes do POST — valide também entrada formatada na UI.

## TED / transferência bancária

1. No sandbox, após criar a transferência, a **confirmação ou falha** é feita manualmente na **UI do Asaas** (não via API).
2. A modalidade final pode ser **Pix** se o banco participa do arranjo — verifique `operationType` na resposta, não só o formulário.
3. Para favorecido PF com CPF diferente da conta, informe **data de nascimento** do titular.

## Saldo e taxa

- O débito inclui taxa quando aplicável; a Alusa estima taxa via `getMyAccountFees` antes de confirmar.

## Reconciliação

- Webhooks `TRANSFER_*` são fonte principal de mudança de estado.
- Job/reconciliação local corrige drift em transferências abertas.

---
applyTo: '**'
---

## Integração Financeira – Asaas (Contrato Operacional)

### Papel do Asaas no Sistema

O **Asaas** é o **sistema soberano de estados financeiros** da Alusa.

- Nenhum estado financeiro é inferido localmente.
- Pagamentos, inadimplência, cancelamentos e falhas
  **só são considerados válidos quando confirmados por eventos do Asaas**.
- O backend da Alusa **reage a eventos**, não antecipa estados.
- Não deve ser citado o Asaas no frontend; o Asaas age apenas no backend.

📌 O Asaas é a **fonte única da verdade financeira**.

---

### Clientes Financeiros (Customers)

- Apenas **responsáveis financeiros** são cadastrados como clientes no Asaas.
- Alunos dependentes **nunca** possuem `asaasCustomerId`.
- A existência de um `asaasCustomerId` implica:
  - entidade pagadora válida
  - vínculo com uma subconta específica

📌 Nunca criar cliente financeiro para aluno dependente.

---

### Subcontas (Whitelabel)

- Cada instituição possui sua **própria subconta Asaas**.
- Não existe compartilhamento de:
  - clientes
  - cobranças
  - pagamentos
- Toda operação financeira deve:
  - identificar a subconta correta
  - validar vínculo antes de executar ações

📌 Subcontas são isolamentos financeiros obrigatórios.

---

### Cobranças

- Cobranças podem ser:
  - recorrentes (mensalidades)
  - avulsas (taxas, materiais, multas)
- Toda cobrança deve possuir:
  - `asaasCustomerId` válido
  - vínculo com matrícula e plano
  - identificação da subconta
- Cobranças recorrentes representam **contratos financeiros ativos**.

📌 Nunca criar cobrança sem vínculo acadêmico rastreável.

---

### Webhooks

- Webhooks do Asaas são:
  - obrigatórios
  - idempotentes
  - tolerantes a reenvio
- Eventos financeiros **não podem ser simulados ou inferidos**.
- Atualizações de estado financeiro devem ocorrer:
  - exclusivamente via webhook
  - com validação de origem
  - com prevenção de duplicidade

📌 Webhooks são a única forma válida de mutação de estado financeiro.

---

### Inadimplência

- Inadimplência é um **estado de negócio**, não um cálculo local.
- Um aluno/matrícula só é considerado inadimplente quando:
  - o Asaas emite evento correspondente
- Ações automáticas podem ser disparadas a partir desse estado:
  - bloqueios
  - restrições
  - sinalizações administrativas

📌 Nunca marcar inadimplência manualmente ou por suposição.

---

### Cancelamentos e Suspensões

- Cancelamento de cobranças:
  - deve ocorrer no Asaas
  - deve ser confirmado por webhook
- Suspensões não eliminam histórico.
- Estados locais devem refletir exatamente o estado externo.

📌 O Asaas dita o estado final.

---

### Reprocessamento e Auditoria

- O sistema deve permitir:
  - reprocessamento seguro de webhooks
  - auditoria completa de eventos financeiros
- Logs devem preservar:
  - payload original
  - data de processamento
  - idempotency key

📌 Auditoria é requisito funcional, não opcional.

---

### Princípios Invioláveis

- Nunca inferir estado financeiro
- Nunca criar cliente financeiro para aluno dependente
- Nunca gerar cobrança sem vínculo acadêmico
- Nunca ignorar webhook
- Nunca misturar subcontas

Violação desses princípios é **erro de sistema**, não exceção.
---
applyTo: '**'
---

Você é o assistente de desenvolvimento do projeto **Alusa**.  
Siga **estritamente** estas regras.

---

## 1. 🚫 Proibição absoluta de documentação espontânea

- **Não gere documentação** em nenhuma circunstância, a menos que o usuário **peça explicitamente**, usando termos como:
  - “explique”
  - “documente”
  - “descreva”
  - “gerar README”
  - “criar doc”
  - “gerar documentação”
- Isso inclui (mas não se limita a):
  - Arquivos `.md`, `.txt`, README
  - Explicações longas
  - Diagramas, fluxos, ADRs
  - Textos descritivos fora do código

➡️ **Correções, refactors e novas features nunca devem gerar documentação automaticamente.**

### Asaas / Whitelabel
- A **única fonte da verdade** para regras, payloads, eventos e fluxos do **:contentReference[oaicite:0]{index=0}** é:
  - `docs/Doc Asaas/` (todos os `.md` nessa pasta)
- Em caso de dúvida sobre Asaas:
  1. Priorize `docs/Doc Asaas/`
  2. Se faltar contexto, **pergunte objetivamente** (sandbox vs produção, endpoint, evento, objetivo)
  3. Quando aplicável, use MCP **somente** para confirmar dados oficiais

---

## 2. 🎯 Fatia vertical obrigatória (regra realista)

- Sempre que solicitado a desenvolver uma feature completa, entregar:
  - Banco / persistência
  - API / backend
  - Validações
  - UI (se aplicável)
  - Testes
- Se o usuário pedir **apenas uma parte**, entregue **somente essa parte**.
- **Nunca “complete” a feature por conta própria**
  - Não criar arquivos extras
  - Não criar documentação
  - Não antecipar decisões

---

## 3. ✂️ Zero redundância

- Não repetir instruções
- Não resumir conversas anteriores
- Não gerar análises longas
- Não explicar o que já está explícito no código

➡️ **Respostas devem ser curtas, diretas e objetivas.**

---

## 4. 🧩 Explicações mínimas no código

- Código deve ser **autoexplicativo**
- Comentários apenas quando estritamente necessários:
  - Curto
  - Objetivo
  - No formato `// por que`
- **Nunca** usar comentários longos ou blocos explicativos

---

## 5. 🤖 Produza exclusivamente o que foi solicitado

- Não sugerir:
  - Documentação
  - README
  - Checklist
  - ADR
  - Arquitetura
- Não criar arquivos adicionais sem pedido explícito
- Não extrapolar escopo

➡️ **Solicitação do usuário define o limite exato da entrega.**

---

## 6. 🧼 Código > explicação

- Priorizar:
  - Código limpo
  - Tipagem forte
  - Fluxos explícitos
  - Consistência entre camadas
- Evitar:
  - `any`
  - Casts inseguros
  - Lógica implícita
- O código **substitui documentação**.

---

## 7. 🔐 Integrações críticas (financeiro / externo)

- Integrações externas devem ser tratadas como **contratos**, não como chamadas best-effort.
- Nunca assumir sucesso apenas por ausência de erro ou log.
- Webhooks:
  - Devem ser idempotentes
  - Seguros
  - Rápidos
- Pagamentos e estados financeiros **não são considerados finais sem confirmação assíncrona**.

*(Sem documentação, sem explicação extra — apenas código correto.)*

---

### Resumo final (inviolável)

> **Não gere documentação sem pedido explícito.**  
> **Não extrapole escopo.**  
> **Não explique além do necessário.**  
> **Entregue código limpo, direto e completo.**

Se houver ambiguidade ou conflito de regra, **pergunte antes de agir**.
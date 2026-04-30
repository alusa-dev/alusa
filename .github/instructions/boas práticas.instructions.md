---
applyTo: '**'
---

## Regras Arquiteturais e de Boas Práticas (Atualizado)

Estas regras definem **critérios obrigatórios de qualidade, segurança e consistência** para todo código gerado, sugerido ou modificado no projeto.

---

### 1. Qualidade de Código (Obrigatório)

- Seguir princípios de **Clean Code**:
  - Funções pequenas, nomes explícitos, responsabilidades únicas.
- Evitar duplicação de lógica (**DRY**).
- Aplicar **SOLID** e **Clean Architecture** sempre que houver domínio ou regra de negócio.
- Priorizar **legibilidade, previsibilidade e auditabilidade** sobre “atalhos”.
- Usar **TypeScript com tipagem forte** (evitar `any`, casts inseguros e validações implícitas).

---

### 2. Organização e Arquitetura

- Respeitar rigorosamente a **estrutura de pastas** definida no projeto.
- Separar claramente:
  - **Domínio / regras de negócio**
  - **Infraestrutura (APIs externas, banco, filas)**
  - **Camada de entrega (controllers, routes, handlers)**
- Isolar integrações externas em **services dedicados** (ex.: `AsaasService`).
- Evitar lógica de negócio em controllers, routes ou handlers de webhook.

---

### 3. Legibilidade e Manutenibilidade

- Usar nomes claros, explícitos e sem ambiguidade.
- Código deve ser **autoexplicativo**; comentários apenas quando houver regra de negócio não trivial.
- Manter **consistência de formatação** (ESLint + Prettier).
- Preferir **fluxos explícitos** a mágicas implícitas.

---

### 4. Fluxo de Desenvolvimento (Regra Atualizada)

- Trabalhar em **fatias verticais completas**, mas:
  - **Nunca** assumir sucesso apenas por ausência de erro.
  - Fluxos críticos devem ser **confirmáveis e auditáveis**.
- Features só são consideradas concluídas quando:
  - Fluxo principal funciona
  - Erros são tratados
  - Estados intermediários são considerados
  - Testes refletem o comportamento esperado

---

### 5. Integrações Externas (Financeiras e Críticas)

Integrações externas (ex.: **:contentReference[oaicite:0]{index=0}**) devem ser tratadas como **contratos formais**, não como simples chamadas HTTP.

#### Regras obrigatórias:
- **Nunca** confiar apenas em logs ou execução sem erro.
- Sucesso só é válido com:
  - HTTP `2xx`
  - Validação explícita do payload retornado (`id`, `status`, `deleted`, etc.)
- Após `create` ou `update`, considerar **confirmação ativa via GET** quando fizer sentido (reconciliação/auditoria).

#### Webhooks:
- Deve existir **um endpoint único** para webhooks, roteado por tipo de evento.
- Webhooks são a **fonte oficial de confirmação assíncrona**.
- Todo webhook deve ser:
  - **Idempotente** (eventos podem ser reenviados)
  - **Seguro** (validação de token/assinatura)
  - **Rápido** (responder 200 o quanto antes)
- Nunca assumir pagamento, exclusão ou mudança de estado crítico **sem webhook**.

#### Persistência:
- Sempre persistir localmente:
  - IDs externos
  - Status sincronizado
  - Timestamp de última sincronização
- O sistema deve permitir **reprocessamento e reconciliação**.

---

### 6. Testes como Contrato (Atualização Importante)

- Testes não são opcionais nem decorativos — **eles definem o comportamento esperado**.
- Sempre escrever testes que:
  - Falhem se regras críticas forem violadas
  - Cubram cenários de sucesso, erro, duplicidade e exceção
- Integrações externas devem ter:
  - Mocks realistas
  - Testes de idempotência
  - Testes de erro (`4xx`, `5xx`, `429`)
- Webhooks devem ser testados contra:
  - Evento duplicado
  - Token inválido
  - Payload inesperado
- Cobertura mínima continua sendo **80%**, mas **qualidade > número**.

📌 *Testes existem para proteger o sistema **e educar o Copilot***.

---

### 7. Observabilidade e Confiabilidade

- Logs devem:
  - Ajudar auditoria e debug
  - Nunca ser usados como confirmação de sucesso
- Sempre que possível:
  - Usar correlation IDs
  - Registrar eventos externos processados
- Evitar mascarar erros críticos.

---

### 8. Frontend, UX e Estados

- Interfaces devem:
  - Ser responsivas (desktop e mobile)
  - Tratar loading, erro e sucesso de forma explícita
- Fluxos que dependem de confirmação assíncrona devem refletir isso no UX
  (ex.: “processando”, “aguardando confirmação”).

---

### 9. Entrega e Revisão

Toda entrega deve incluir:
- Arquivos criados ou modificados
- Código final revisado
- Testes correspondentes
- Sugestão de commits semânticos:
  - `feat:`
  - `fix:`
  - `refactor:`
  - `test:`
  - `chore:`

---

## Diretriz Final

Sempre que desenvolver uma feature, correção ou refatoração:

- **Aplique rigorosamente estas regras**
- Se identificar conflito, dúvida arquitetural ou inconsistência:
  - **Sinalize antes de prosseguir**
- O código entregue deve estar:
  - Funcional
  - Testado
  - Alinhado às decisões arquiteturais
  - Pronto para produção

> **Velocidade sem consistência não é progresso.**
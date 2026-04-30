---
applyTo: '**'
---

## Sobre a Alusa

A **Alusa** é uma plataforma de **gestão educacional integrada com automação financeira nativa**, projetada para **eliminar retrabalho, inconsistências operacionais e inadimplência não rastreável**.

O sistema conecta entidades acadêmicas — **instituições, turmas, salas, modalidades, professores, alunos e matrículas** — a uma **camada financeira estruturada**, garantindo que **todo evento acadêmico relevante possua um estado financeiro claro, verificável e auditável**.

A Alusa opera a camada financeira por meio de **integração Whitelabel com o Asaas**, permitindo controle completo sobre:
- clientes financeiros
- cobranças recorrentes e avulsas
- inadimplência
- conciliação
- isolamento financeiro por instituição

📌 **Acadêmico e financeiro não são módulos separados — são partes do mesmo fluxo de negócio.**

---

## Objetivo do Produto

Resolver problemas estruturais recorrentes em instituições de ensino:

- inadimplência sem estado claro ou histórico confiável
- cobranças manuais ou desconectadas da matrícula
- retrabalho entre equipes acadêmicas e financeiras
- ausência de vínculo entre plano contratado e cobrança gerada
- falta de rastreabilidade entre o que foi vendido, cobrado e pago

A Alusa garante que **nenhuma matrícula relevante exista sem um contexto financeiro definido**, explícito e sincronizado.

---

## Princípios Fundamentais do Sistema

### 1. Fluxos acadêmicos e financeiros acoplados por regra

- Matrícula não é apenas um registro acadêmico.
- Toda matrícula pode estar vinculada a:
  - plano financeiro
  - cliente financeiro (pagador)
  - cobranças recorrentes e/ou avulsas
  - histórico de pagamentos
  - estado de inadimplência

📌 **Se existe vínculo acadêmico, existe (ou existiu) um estado financeiro correspondente.**

---

### 2. Responsável financeiro como entidade central de cobrança

- Alunos **podem ou não** ser os pagadores.
- O sistema distingue explicitamente:
  - **aluno acadêmico**
  - **responsável financeiro**
- Apenas o responsável financeiro:
  - é cadastrado como cliente no Asaas
  - possui `asaasCustomerId`
- Alunos dependentes **não são clientes financeiros**, apenas vinculados ao responsável.

📌 Essa regra é estrutural e impede cobranças inconsistentes ou duplicadas.

---

### 3. Cobranças recorrentes como padrão operacional

- Planos financeiros podem gerar:
  - cobranças recorrentes (ex: mensalidades)
  - cobranças pontuais (taxas, materiais, multas)
- Cobranças recorrentes:
  - são criadas no Asaas
  - possuem vínculo direto com matrícula, plano e responsável financeiro
- O sistema mantém sincronização contínua de status:
  - ativa
  - suspensa
  - cancelada
  - inadimplente

📌 A recorrência é tratada como **contrato financeiro ativo**, não como conveniência.

---

### 4. Inadimplência como estado de negócio (não exceção)

A Alusa trata inadimplência como **estado explícito do sistema**, não apenas como atraso financeiro.

- Detecção automática de:
  - cobranças vencidas
  - pagamentos não confirmados
- Atualização de estado ocorre **exclusivamente via webhooks do Asaas**
- A inadimplência pode disparar:
  - bloqueio de novas matrículas
  - restrição de ações acadêmicas
  - sinalização clara no painel administrativo

📌 Nenhuma decisão depende de conferência manual ou interpretação humana.

---

### 5. Webhooks como fonte única da verdade financeira

- Estados financeiros **não são inferidos localmente**.
- Pagamentos, cancelamentos, falhas e inadimplência:
  - só são confirmados por eventos oficiais do Asaas
- Processamento de eventos:
  - idempotente
  - tolerante a reenvio
  - seguro contra duplicidade
- O sistema permite:
  - reprocessamento controlado
  - auditoria completa
  - diagnóstico rápido de inconsistências

📌 O backend financeiro é **reativo a eventos**, não baseado em suposições.

---

## Integração Financeira (Asaas Whitelabel)

### Subcontas isoladas por instituição

- Cada instituição opera com sua própria subconta Asaas.
- Há isolamento financeiro total entre instituições:
  - clientes
  - cobranças
  - recebimentos
  - conciliação
- A Alusa é responsável por:
  - criação da subconta
  - manutenção
  - sincronização de status
  - vínculo correto das cobranças

📌 O isolamento é estrutural, não apenas organizacional.

---

## Automação financeira com rastreabilidade total

- Toda cobrança possui:
  - vínculo com matrícula
  - vínculo com plano financeiro
  - vínculo com responsável financeiro
  - vínculo com a subconta da instituição
- Eventos financeiros possuem:
  - histórico completo
  - origem verificável
  - possibilidade de auditoria

📌 Qualquer valor cobrado pode ser rastreado até sua origem acadêmica.

---

## Problemas que a Alusa resolve

- Inadimplência invisível ou descontrolada
- Cobranças feitas fora do sistema
- Planilhas paralelas
- Falta de visibilidade financeira em tempo real
- Desalinhamento entre o que foi contratado e o que foi cobrado

---

## Como o sistema resolve

- **Fluxos verticais completos**:
  - matrícula → plano → responsável → cobrança → pagamento → estado
- **Automação por padrão**:
  - menos intervenção humana
  - menos erro operacional
- **Regras de negócio explícitas**:
  - inadimplência é estado, não exceção
- **Integrações externas tratadas como contrato**
  - nunca como best-effort

---

## Resultado Esperado

Uma plataforma que permite às instituições:

- reduzir inadimplência de forma ativa
- automatizar cobranças recorrentes
- acompanhar pagamentos em tempo real
- tomar decisões acadêmicas baseadas em estado financeiro real
- operar com **menos esforço, menos erro e mais previsibilidade**

A Alusa garante que **acadêmico e financeiro nunca evoluam de forma independente**.
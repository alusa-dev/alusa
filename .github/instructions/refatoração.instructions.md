---
applyTo: '**'
---

## Regras para Refatoração (Atualizado)

Estas regras se aplicam sempre que o usuário solicitar **refatoração**, **melhoria de código** ou **ajuste estrutural**.

---

## 1. Contexto obrigatório (antes de refatorar)

- Leia e compreenda o código existente **antes de propor mudanças**.
- Avalie se a refatoração é **necessária**.
  Exemplos válidos:
  - duplicação real de lógica
  - baixa legibilidade
  - funções grandes ou acopladas
  - tipagem fraca ou inexistente
  - violação clara de padrões do projeto
- ❌ Não refatore por preferência pessoal ou estética.

---

## 2. Objetivo da refatoração

A refatoração deve **claramente** atender a pelo menos um dos pontos abaixo:

- Melhorar legibilidade **sem mudar comportamento**
- Reduzir duplicação de lógica
- Isolar responsabilidades
- Tornar o código mais previsível e testável
- Melhorar performance **sem sacrificar clareza**
- Alinhar o código às regras arquiteturais do projeto

Se nenhum desses objetivos for atendido, **não refatore**.

---

## 3. Regras obrigatórias

- ❌ **Nunca quebrar comportamento existente**
- ❌ **Nunca remover testes existentes**
- ✅ Ajustar testes **somente se necessário** para refletir o mesmo comportamento
- ✅ Criar novos testes **apenas** se a refatoração introduzir novos caminhos lógicos
- ❌ Não reescrever do zero
- ❌ Não alterar API pública sem confirmação explícita
- ❌ Não “aproveitar” a refatoração para adicionar features

---

## 4. Escopo e impacto

- Refatorações devem ser:
  - **Incrementais**
  - **Contidas**
  - **Fáceis de revisar**
- Evitar:
  - renomeações sem ganho real
  - mudanças cosméticas
  - alterações amplas em arquivos não relacionados
- Se identificar problema de fluxo, arquitetura ou regra de negócio:
  - **pare e sinalize**
  - **não altere sem confirmação**

---

## 5. Código acima de explicação

- Priorize **código claro** em vez de explicações.
- Comentários:
  - somente quando estritamente necessários
  - curtos
  - formato `// por que`
- ❌ Não escrever explicações longas
- ❌ Não gerar documentação, listas narrativas ou trade-offs **a menos que o usuário peça explicitamente**

---

## 6. Formato de entrega (obrigatório)

- Mostrar **somente**:
  - código refatorado
  - arquivos alterados (se aplicável)
- ❌ Não listar “motivos”, “benefícios”, “trade-offs” ou “antes/depois”  
  *(a menos que o usuário solicite explicitamente)*

---

## 7. Testes como contrato

- Se testes existem:
  - eles definem o comportamento correto
  - a refatoração deve **passar exatamente os mesmos testes**
- Se não existem testes:
  - **não assumir comportamento**
  - perguntar antes de refatorar partes críticas

---

## Regra final

> **Refatorar é preservar comportamento melhorando estrutura.**  
> **Qualquer mudança que altere comportamento não é refatoração.**

Se houver qualquer dúvida sobre impacto, escopo ou intenção, **pergunte antes de agir**.
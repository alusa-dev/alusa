# Fluxo de Rematrícula — Plataforma Alusa

## Índice
- [Visão Geral](#visão-geral)
- [Contexto de Negócio](#contexto-de-negócio)
- [Regras e Boas Práticas](#regras-e-boas-práticas)
- [Fluxo Técnico Completo](#fluxo-técnico-completo)
  - [1. Identificação de Matrículas Elegíveis](#1-identificação-de-matrículas-elegíveis)
  - [2. UI/UX do Modal de Rematrícula](#2-uiux-do-modal-de-rematrícula)
  - [3. Validações e Campos Obrigatórios](#3-validações-e-campos-obrigatórios)
  - [4. Lógica de Backend](#4-lógica-de-backend)
  - [5. Integração com Asaas](#5-integração-com-asaas)
  - [6. Logs e Auditoria](#6-logs-e-auditoria)
  - [7. Testes e Cobertura](#7-testes-e-cobertura)
- [Cenários de Exceção](#cenários-de-exceção)
- [Referências e Documentação Oficial](#referências-e-documentação-oficial)

---

## Visão Geral
O fluxo de rematrícula da Alusa foi projetado para garantir **transparência, rastreabilidade e total aderência às melhores práticas de integração com o Asaas**. O objetivo é evitar cobranças duplicadas, garantir que contratos sejam renovados corretamente e que todo o processo seja auditável e seguro.

## Contexto de Negócio
- **Rematrícula**: Processo de renovação do contrato de um aluno, criando uma nova matrícula e encerrando a anterior.
- **Subscription Asaas**: Cada matrícula ativa possui uma assinatura (subscription) no Asaas, responsável por gerar cobranças recorrentes.
- **Contrato**: Definido por `dataInicio` e `dataFimContrato`. Após o fim, o aluno pode ser rematriculado.

## Regras e Boas Práticas
- **Sempre criar subscription com `endDate`** (data de término do contrato) no Asaas.
- **Ao rematricular, cancelar a subscription antiga** (DELETE no Asaas) para evitar cobranças duplicadas.
- **Cancelar cobranças pendentes/atrasadas localmente** ao rematricular.
- **Logs detalhados** para cada ação relevante (início, cancelamento, erros, etc).
- **Validação obrigatória de campos críticos** (ex: `dataFimContrato`).
- **UI/UX consistente**: campos obrigatórios sinalizados, feedback visual para erros e sucesso.
- **Cobertura de testes unitários e integração** para todos os fluxos críticos.

## Fluxo Técnico Completo

### 1. Identificação de Matrículas Elegíveis
- Matrículas elegíveis para rematrícula são aquelas com `statusContrato = ENCERRADO` ou `dataFimContrato` próxima do vencimento.
- Endpoint: `listarRematriculasElegiveis` retorna lista paginada para UI.

### 2. UI/UX do Modal de Rematrícula
- Modal segue padrão visual do `AlunoEditDialog`.
- Campos obrigatórios destacados (ex: `dataFimContrato` com asterisco).
- Validação visual e textual para datas inválidas.
- Feedback de loading, erro e sucesso.
- Permite seleção de qualquer turma ativa.

### 3. Validações e Campos Obrigatórios
- `dataFimContrato` **obrigatório** e deve ser posterior à `dataInicio`.
- Não permite rematrícula se `dataInicio` da nova for anterior ao fim do contrato anterior.
- Todos os campos críticos validados tanto no frontend quanto no backend.

### 4. Lógica de Backend
- Função principal: `criarRematricula` (`packages/lib/src/services/rematricula.ts`)
- Passos:
  1. Valida dados e permissões.
  2. Loga início da operação (`REMATRICULA_INICIADA`).
  3. Se existir `asaasSubscriptionId` na matrícula antiga:
     - Chama `deleteSubscription` no Asaas (cancela assinatura e cobranças pendentes).
     - Loga sucesso, erro ou 404.
  4. Cancela cobranças locais pendentes/atrasadas (`COBRANCAS_CANCELADAS_REMATRICULA`).
  5. Cria nova matrícula (com nova subscription e novo `endDate`).
  6. Marca matrícula anterior como `statusContrato = ENCERRADO`.
  7. Loga conclusão (`REMATRICULA_GERADA`).

### 5. Integração com Asaas
- Subscription criada sempre com `endDate` (data de término do contrato).
- Ao deletar subscription, Asaas remove cobranças pendentes/vencidas automaticamente.
- Webhooks processam eventos `SUBSCRIPTION_DELETED`, `PAYMENT_*` para manter status sincronizado.
- Job de expiração de contratos apenas marca como `ENCERRADO` (não deleta subscription, pois `endDate` já impede novas cobranças).

### 6. Logs e Auditoria
- Todas as ações relevantes são logadas em `MatriculaLog`:
  - `REMATRICULA_INICIADA`
  - `ASSINATURA_ANTERIOR_CANCELADA`
  - `ASSINATURA_ANTERIOR_NAO_ENCONTRADA`
  - `ASSINATURA_ANTERIOR_ERRO_CANCELAMENTO`
  - `COBRANCAS_CANCELADAS_REMATRICULA`
  - `REMATRICULA_GERADA`
  - `ASAAS_INTEGRADO` (inclui `endDate`, `billingType`, `cycle`)
- Permite rastreabilidade total para auditoria e suporte.

### 7. Testes e Cobertura
- Testes unitários cobrem:
  - Rematrícula com/sem subscription antiga
  - Cancelamento de subscription (sucesso, erro, 404)
  - Cancelamento de cobranças locais
  - Integração desabilitada
- Testes de UI garantem validação visual e feedback ao usuário.

## Cenários de Exceção
- **Subscription já deletada no Asaas**: erro 404 tratado e logado, fluxo continua normalmente.
- **Erro ao cancelar subscription**: loga erro, mas não aborta rematrícula (desde que `endDate` já impeça novas cobranças).
- **Cobranças locais não encontradas**: loga e continua.
- **Campos obrigatórios ausentes**: bloqueia operação e retorna erro claro ao usuário.

## Referências e Documentação Oficial
- [Asaas API - Criar Assinatura](https://docs.asaas.com/reference/criar-nova-assinatura)
- [Asaas API - Remover Assinatura](https://docs.asaas.com/reference/remover-assinatura)
- [Asaas API - Webhooks](https://docs.asaas.com/reference/webhooks)
- [Alusa - rematricula.ts](../../packages/lib/src/services/rematricula.ts)
- [Alusa - RematriculaDialog.tsx](../../apps/web/components/matriculas/RematriculaDialog.tsx)

---

> **Este documento cobre todo o fluxo de rematrícula, lógica, integrações, UI/UX, logs, testes e exceções, alinhado às melhores práticas e à documentação oficial do Asaas.**

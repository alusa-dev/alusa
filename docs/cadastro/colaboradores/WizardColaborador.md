# Documentação — Wizard de Cadastro de Colaborador

---

## 1. Estrutura do Wizard
- Componente principal: `ColaboradorWizard.tsx` (ex: `apps/web/features/colaboradores/components/ColaboradorWizard.tsx`)
- Utiliza steps (etapas) para guiar o usuário no cadastro completo
- Cada etapa é um subcomponente:
  - `StepDadosPessoais.tsx` (nome, CPF, RG, nascimento)
  - `StepContato.tsx` (telefone, email, endereço)
  - `StepCargo.tsx` (seleção de cargo, matrícula, data de admissão)
  - `StepDocumentos.tsx` (upload de arquivos, se aplicável)
  - `StepResumo.tsx` (confirmação final)
- Controle de estado via hook: `useColaboradorWizard.ts` (controle de step, dados, validação)

---

## 2. Padrão Visual
- Layout mobile-first, modal ou página dedicada
- Barra de progresso no topo (`Stepper` ou `ProgressBar`)
- Cards/inputs com `rounded-xl`, `shadow-md`, `p-6`
- Botões de navegação: `Próximo`, `Voltar`, `Finalizar` (`bg-brand-primary`, feedback visual)
- Inputs com máscara e validação inline
- Feedback visual para erros, loading e sucesso
- Acessibilidade: navegação por teclado, labels associadas, aria-label nos botões

---

## 3. Lógica e Fluxo
- Estado centralizado: dados do colaborador, step atual, validação
- Validação Zod por etapa (dados pessoais, contato, cargo, documentos)
- Navegação controlada: não permite avançar sem validar etapa
- Submit final chama API `/api/colaboradores` (POST)
- Feedback visual: toast/modal para sucesso/erro
- Permite salvar rascunho (opcional)
- Suporte a edição de etapas antes do envio

---

## 4. Componentes Utilizados
- `ColaboradorWizard`: container principal
- `StepDadosPessoais`, `StepContato`, `StepCargo`, `StepDocumentos`, `StepResumo`
- `Stepper` ou `ProgressBar` para navegação
- Botões: `Próximo`, `Voltar`, `Finalizar`
- Hooks: `useColaboradorWizard` (controle de estado e navegação)
- Tipos: `ColaboradorWizardData`, `ColaboradorWizardStep`

---

## 5. Testes
- Unitários para cada step e validação
- Integração para fluxo completo do wizard
- E2E para cadastro multi-step
- Cobertura mínima recomendada: 80%

---

## 6. Recomendações Gerais
- Centralize validação e estado no hook
- Mantenha responsividade e acessibilidade
- Teste todos fluxos (unitário, integração, E2E)
- Siga padrão de props e estrutura para steps
- Permita edição de etapas antes do envio
- Documente regras de negócio específicas do wizard

---

## 7. Exemplo de Fluxo
1. Usuário inicia cadastro de colaborador
2. Preenche dados pessoais, valida e avança
3. Preenche contato, valida e avança
4. Seleciona cargo, matrícula, data de admissão, valida e avança
5. (Opcional) Faz upload de documentos
6. Confere resumo e finaliza cadastro
7. API persiste dados, frontend mostra toast de sucesso

---

## 8. Observações
- Adote empty states amigáveis para etapas sem dados
- Feedback visual claro para erros e sucesso
- Permita navegação flexível entre etapas
- Mantenha documentação atualizada conforme evolução do wizard

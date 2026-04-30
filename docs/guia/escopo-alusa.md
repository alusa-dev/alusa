# Escopo Alusa — Documento Consolidado

---

## 1. Visão Geral
O projeto Alusa é uma plataforma digital voltada para a **gestão educacional inteligente**, conectando instituições, professores e alunos em um ecossistema integrado. O objetivo principal é simplificar a administração de turmas, salas e modalidades, garantindo que todo o processo de criação, matrícula e acompanhamento acadêmico seja ágil, fluido e eficiente.

---

## 2. Objetivos do Projeto

### 2.1. Objetivo Principal
- Resolver problemas de **desorganização e retrabalho** na gestão acadêmica, oferecendo às instituições ferramentas para:
  - Montar turmas de forma rápida e estruturada.
  - Definir salas e modalidades sem perda de informação.
  - Garantir que fluxos como o **wizard de matrícula** funcionem de ponta a ponta, sem falhas ou etapas faltando.

### 2.2. Objetivos Secundários
- **Automação**: Reduzir tarefas manuais, como geração de cobranças e envio de notificações.
- **Integração**: Conectar o sistema a APIs externas, como Asaas e Twilio.
- **Acessibilidade**: Garantir que a plataforma seja responsiva e acessível para todos os usuários.

---

## 3. Funcionalidades Principais

### 3.1. Cadastro
- **Alunos**: Gerenciamento completo de informações dos alunos.
- **Colaboradores**: Cadastro e gestão de professores e outros funcionários.
- **Salas**: Definição de salas e capacidade.
- **Modalidades**: Configuração de modalidades de ensino (presencial, online, híbrido).
- **Turmas**: Criação e gestão de turmas, vinculando salas e modalidades.
- **Planos e Combos**: Estruturação de planos de pagamento e pacotes de serviços.

### 3.2. Matrículas
- **Wizard de Matrícula**: Processo guiado para matrícula de alunos, com validações automáticas.
- **Gestão de Pagamentos**: Integração com gateways de pagamento para cobranças e parcelamentos.

### 3.3. Relatórios
- **Indicadores**: Dashboards com métricas relevantes (ex.: turmas ativas, quantidade de alunos).
- **Exportação**: Geração de relatórios em formatos como PDF e Excel.

### 3.4. Integrações
- **Asaas**: Automação de cobranças e suporte ao Pix.
- **Twilio**: Envio de notificações via SMS e WhatsApp.

---

## 4. Arquitetura do Sistema

### 4.1. Estrutura Geral
- **Frontend**: Desenvolvido em Next.js, utilizando TypeScript e Tailwind CSS.
- **Backend**: Baseado em Node.js, com Prisma para gerenciamento do banco de dados.
- **Banco de Dados**: PostgreSQL, com suporte a migrations e seeds.
- **Testes**: Cobertura com Vitest (unitários e integração) e Playwright (E2E).

### 4.2. Fluxo de Dados
1. O usuário interage com a interface no frontend.
2. As requisições são enviadas para a API no backend.
3. O backend processa as requisições e interage com o banco de dados.
4. As respostas são retornadas ao frontend para exibição ao usuário.

---

## 5. Boas Práticas Adotadas
- **Clean Code**: Código legível, modular e sem duplicações.
- **SOLID**: Princípios de design para garantir manutenibilidade.
- **Responsividade**: Design mobile-first, garantindo boa experiência em qualquer dispositivo.
- **Testes**: Cobertura mínima de 80%, validando cenários de sucesso, erro e exceção.
- **Documentação**: Manutenção de documentação clara e atualizada.

---

## 6. Alterações e Ajustes Durante o Desenvolvimento

### 6.1. Funcionalidades Removidas
- **Gamificação**: A ideia de incluir gamificação foi descartada devido à complexidade e falta de prioridade.
- **Integração com redes sociais**: Removida para focar em funcionalidades essenciais.

### 6.2. Funcionalidades Adicionadas
- **Antecipação de Recebíveis**: Implementada na integração com o Asaas.
- **Notificações via WhatsApp**: Adicionada na integração com o Twilio.

### 6.3. Ajustes de Escopo
- **Relatórios**: Expansão para incluir filtros avançados e exportação.
- **Matrículas**: Melhorias no wizard para validações mais robustas.

---

## 7. Próximos Passos
- **Melhorias na Integração com Asaas**:
  - Suporte a mais métodos de pagamento.
  - Automação de notificações de cobrança.
- **Aprimoramento de Relatórios**:
  - Adicionar gráficos interativos.
  - Permitir agendamento de envio automático.
- **Expansão de Funcionalidades**:
  - Implementar um módulo de comunicação interna (chat entre alunos e professores).
  - Criar um dashboard para acompanhamento de desempenho acadêmico.

---

## 8. Conclusão
O escopo do projeto Alusa foi ajustado ao longo do desenvolvimento para atender às necessidades reais dos usuários e garantir a entrega de um sistema robusto e eficiente. Este documento consolidado reflete o estado atual do projeto e serve como referência para futuras evoluções.

---

## 9. Referências
- Documentação técnica do projeto.
- Feedback de usuários e stakeholders.
- Boas práticas de desenvolvimento de software.
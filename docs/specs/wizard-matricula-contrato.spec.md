---
title: wizard-matricula-contrato.spec.md
---

# Especificação — Associação de Contrato no Wizard de Matrícula

## Objetivo
Garantir que toda matrícula seja vinculada a um contrato gerado a partir de um template, de forma padronizada, segura e automatizada.

## Fluxo Principal

1. **Seleção de Template de Contrato**
   - No wizard de matrícula, o usuário visualiza um select com os templates de contrato disponíveis.
   - Cada template exibe nome e breve descrição.
   - **Recomendação de UX:** O select de template de contrato deve ser exibido na mesma etapa em que o usuário define o período do contrato (datas de início e fim), junto com as demais informações contratuais. Isso garante que o contrato será gerado já com todos os dados essenciais definidos, tornando o fluxo mais intuitivo e seguro.

2. **Geração Automática do Contrato**
   - Após selecionar o template, o sistema gera automaticamente o contrato, preenchendo os dados da matrícula (aluno, responsável, turma, plano, valores, descontos, etc).
   - O contrato gerado é apresentado para conferência e aceite (visualização e/ou assinatura digital).

3. **Vínculo e Persistência**
   - O contrato gerado é vinculado à matrícula criada.
   - Matrícula só pode ser finalizada se houver contrato válido e aceito.
   - O contrato pode ser acessado a partir da matrícula (visualização, download, compartilhamento).

## Regras de Negócio

- Cada matrícula deve ter um contrato único, gerado a partir de um template.
- Não é permitido selecionar contratos já existentes de outros alunos/matrículas.
- Templates podem ser gerenciados separadamente (criação, edição, exclusão).
- O status do contrato (pendente, aceito, recusado) impacta o status da matrícula.
- Em fluxos especiais (rematrícula, aditivos), pode ser permitido reaproveitar contratos anteriores, mediante regra específica.

## Exceções e Fluxos Alternativos

- **Rematrícula**: opção de gerar novo contrato ou reaproveitar o anterior, conforme configuração.
- **Aditivos**: histórico de versões/aditivos deve ser mantido vinculado à matrícula original.

## Experiência do Usuário

- Feedback visual claro sobre o status do contrato durante e após a matrícula.
- Opção de visualizar/baixar o contrato a qualquer momento.
- Notificações para aceite/assinatura, se aplicável.

## Critérios de Aceite

- [ ] Usuário consegue selecionar template de contrato no wizard de matrícula.
- [ ] Contrato é gerado automaticamente com dados da matrícula.
- [ ] Matrícula não pode ser finalizada sem contrato válido e aceito.
- [ ] Contrato fica acessível a partir da matrícula.
- [ ] Fluxos especiais (rematrícula/aditivos) respeitam as regras acima.

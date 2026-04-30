# Fluxo de Cadastro de Colaboradores

---

## 1. Passo a Passo do Fluxo

1. **Acesso à Página**:
   - O usuário acessa a página de cadastro de colaboradores através do menu lateral (sidebar).
   - A página exibe um formulário com campos obrigatórios e opcionais.

2. **Preenchimento do Formulário**:
   - **Campos Obrigatórios**:
     - Nome completo.
     - CPF (validação de formato e duplicidade).
     - Cargo (ex.: professor, administrador).
     - Contato (e-mail ou telefone).
   - **Campos Opcionais**:
     - Endereço.
     - Data de admissão.

3. **Validações**:
   - Campos obrigatórios não preenchidos exibem mensagens de erro em vermelho.
   - CPF inválido ou já cadastrado impede a submissão.

4. **Submissão**:
   - O botão "Salvar" fica habilitado apenas após o preenchimento correto de todos os campos obrigatórios.
   - Ao clicar em "Salvar":
     - O sistema exibe um estado de carregamento (spinner).
     - Envia os dados para a API de cadastro.

5. **Feedback**:
   - **Sucesso**:
     - Mensagem verde: "Colaborador cadastrado com sucesso!"
     - Redirecionamento opcional para a lista de colaboradores.
   - **Erro**:
     - Mensagem vermelha com detalhes do problema (ex.: "CPF já cadastrado").

---

## 2. Regras de Negócio

- **Campos Obrigatórios**:
  - Nome, CPF, cargo e contato.
- **Restrições**:
  - CPF deve ser único no sistema.
- **Validações**:
  - Formato do CPF (###.###.###-##).
  - E-mail válido (ex.: nome@dominio.com).

---

## 3. Exemplo de Entrada e Saída

### Exemplo de Dados Enviados
```json
{
  "nome": "Maria Oliveira",
  "cpf": "987.654.321-00",
  "cargo": "Professor",
  "contato": {
    "email": "maria.oliveira@email.com",
    "telefone": "(11) 92345-6789"
  },
  "endereco": {
    "rua": "Rua das Palmeiras",
    "numero": 45,
    "cidade": "Rio de Janeiro",
    "estado": "RJ"
  },
  "dataAdmissao": "2025-01-10"
}
```

### Exemplo de Resposta de Sucesso
```json
{
  "mensagem": "Colaborador cadastrado com sucesso!",
  "id": "colaborador_987654"
}
```

### Exemplo de Resposta de Erro
```json
{
  "erro": "CPF já cadastrado."
}
```

---

## 4. Feedback Visual

- **Mensagens de Erro**:
  - Exibidas abaixo do campo correspondente.
  - Ícones de alerta ao lado do campo.
- **Mensagens de Sucesso**:
  - Fundo verde claro com ícone de check.
  - Texto: "Colaborador cadastrado com sucesso!"
- **Estados de Carregamento**:
  - Spinner exibido no botão "Salvar" durante a submissão.

---
# Fluxo de Cadastro de Salas

---

## 1. Passo a Passo do Fluxo

1. **Acesso à Página**:
   - O usuário acessa a página de cadastro de salas através do menu lateral (sidebar).
   - A página exibe um formulário com campos obrigatórios e opcionais.

2. **Preenchimento do Formulário**:
   - **Campos Obrigatórios**:
     - Nome da sala.
     - Capacidade máxima.
   - **Campos Opcionais**:
     - Localização (ex.: prédio, andar).

3. **Validações**:
   - Campos obrigatórios não preenchidos exibem mensagens de erro em vermelho.
   - Capacidade máxima deve ser um número maior que zero.

4. **Submissão**:
   - O botão "Salvar" fica habilitado apenas após o preenchimento correto de todos os campos obrigatórios.
   - Ao clicar em "Salvar":
     - O sistema exibe um estado de carregamento (spinner).
     - Envia os dados para a API de cadastro.

5. **Feedback**:
   - **Sucesso**:
     - Mensagem verde: "Sala cadastrada com sucesso!"
     - Redirecionamento opcional para a lista de salas.
   - **Erro**:
     - Mensagem vermelha com detalhes do problema (ex.: "Capacidade inválida").

---

## 2. Regras de Negócio

- **Campos Obrigatórios**:
  - Nome e capacidade máxima.
- **Restrições**:
  - Capacidade deve ser maior que zero.
- **Validações**:
  - Nome único por localização (se aplicável).

---

## 3. Exemplo de Entrada e Saída

### Exemplo de Dados Enviados
```json
{
  "nome": "Sala 101",
  "capacidade": 30,
  "localizacao": "Prédio A, Andar 1"
}
```

### Exemplo de Resposta de Sucesso
```json
{
  "mensagem": "Sala cadastrada com sucesso!",
  "id": "sala_101"
}
```

### Exemplo de Resposta de Erro
```json
{
  "erro": "Capacidade inválida."
}
```

---

## 4. Feedback Visual

- **Mensagens de Erro**:
  - Exibidas abaixo do campo correspondente.
  - Ícones de alerta ao lado do campo.
- **Mensagens de Sucesso**:
  - Fundo verde claro com ícone de check.
  - Texto: "Sala cadastrada com sucesso!"
- **Estados de Carregamento**:
  - Spinner exibido no botão "Salvar" durante a submissão.

---
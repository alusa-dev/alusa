# Detalhamento do Fluxo de Aprovação de Subcontas

# Introdução

Atualmente, o Asaas possui dois tipos de subcontas:

* Subcontas Padrão (não White Label)
* Subcontas White Label

Ambos os tipos de subconta são criados através do mesmo endpoint:

> **POST** `/api/v3/accounts`\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/criar-subconta)

Porém, o processo de ativação e envio de documentos difere entre elas. Este documento descreve o fluxo detalhado de aprovação de contas para ambos os formatos, incluindo o envio de documentos obrigatórios e o uso correto dos endpoints.

## Fluxo de Aprovação – Subconta Padrão

**Resumo:** Subcontas padrão (não White Label) possuem acesso à interface do Asaas. Após a criação da conta, o responsável recebe um e-mail para redefinição de senha e segue com o envio de documentos diretamente pela interface.

> **Fluxo:**\
> Criação da Subconta\
> → Endpoint: POST `/accounts`\
> → A conta é criada e validada com a Receita Federal.

**Recebimento de E-mail**\
→ O responsável pela conta recebe automaticamente um e-mail para redefinir a senha e acessar o painel do Asaas.

**Redefinição de Senha**\
→ O responsável redefine a senha e realiza o login na interface Asaas.

**Envio de Documentos**\
→ O envio dos documentos obrigatórios ocorre diretamente pela interface do Asaas.\
→ Normalmente solicitados:

* Foto Selfie
* Foto do Documento de Identificação

**Análise e Aprovação**\
→ O time de compliance do Asaas realiza a análise dos documentos enviados.\
→ Conta aprovada.

<br />

## Fluxo de Aprovação – Subconta White Label

**Resumo:** Subcontas White Label não possuem acesso à interface do Asaas. Todo o processo de envio de documentos é realizado via API ou através de um link externo (onboardingUrl), dependendo do tipo de documento.

> **Fluxo:**\
> Criação da Subconta\
> → Endpoint: POST `/accounts`\
> → A conta é criada e inicia-se o processo de validação junto à Receita Federal.

**Aguardar 15 segundos**\
→ Importante: aguarde no mínimo 15 segundos após a criação da conta antes de realizar verificações de documentos.\
→ Motivo: garantir que a validação e a captação dos dados junto à Receita Federal tenham sido concluídas.\
→ Caso essa espera não seja respeitada, o retorno poderá indicar incorretamente que documentos não obrigatórios sejam enviados.

**Verificar Documentos Pendentes**\
→ Endpoint: GET `/myAccount/documents`\
→ Verifica quais documentos precisam ser enviados.\
[Confira a referência completa deste endpoint](https://docs.asaas.com/reference/verificar-documentos-pendentes)

**Analisar Resposta**\
→ Por padrão, para Pessoa Física e Pessoa Jurídica (exceto Associações):

* Foto Selfie
* Foto do Documento de Identificação

→ Para Associações:

* Além dos documentos acima, Ata de Eleição.

**Verificar atributo onboardingUrl**\
**→ Se presente no objeto do documento:**\
✅ Documento deve ser enviado através do link externo (onboardingUrl).\
❌ Não será aceito o envio via API (POST).

**→ Se não presente:**\
✅ Documento deve ser enviado via API:\
→ Endpoint: POST `/myAccount/documents/{id}`\
[Confira a referência completa deste endpoint](https://docs.asaas.com/reference/enviar-documentos)

<br />

**Envio de Documentos**

* **Com onboardingUrl:** link externo, transparente, sem marca Asaas.
* **Sem onboardingUrl:** envio via API.

<br />

**Análise e Aprovação**\
→ O time de compliance do Asaas realiza a análise dos documentos enviados.\
→ Conta aprovada.

> 🚧 Importante
>
> O atributo onboardingUrl determina obrigatoriamente o método de envio do documento.
>
> Nunca tente enviar via API um documento que possui onboardingUrl.\
> → O envio será rejeitado.

Nas subcontas White Label o onboardingUrl é um link sem nenhuma marcação do Asaas, garantindo a experiência white label.

> ❗️ ATENÇÃO:
>
> Respeite o timeout mínimo de 15 segundos após a criação da conta antes de verificar documentos pendentes.

Este fluxo garante que o processo de ativação e envio de documentos seja realizado da forma correta e adequada ao tipo de subconta (Padrão ou White Label), evitando erros comuns e garantindo a conformidade regulatória.
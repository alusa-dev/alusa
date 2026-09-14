# Alusa Mobile System

Documento de referência da experiência mobile da Alusa.

- **Escopo:** aplicativo mobile da Alusa, ERP educacional multi-tenant.
- **Público principal:** diretoras, gestores e equipes administrativas de escolas, cursos e instituições de ensino.
- **Última revisão:** 14/09/2026.
- **Status:** sistema visual e comportamental consolidado; decisões futuras devem ser adicionadas ao final deste documento.
- **Fonte de verdade da implementação:** os tokens e componentes existentes em `apps/mobile/src/theme` e `apps/mobile/src/components`.

Este documento registra intenção, regras de uso, decisões de produto e critérios de qualidade. Ele não substitui os tokens no código nem deve conter valores conflitantes com a implementação.

## 1. Como usar este documento

Antes de criar uma nova página ou componente mobile:

1. Verifique se existe um padrão equivalente neste documento.
2. Reutilize o componente existente antes de criar uma variação.
3. Use os tokens de `src/theme/tokens.ts`; não crie valores de cor, espaçamento ou raio isolados.
4. Defina os estados de carregamento, erro, vazio, sucesso e desabilitado antes de considerar a tela concluída.
5. Preserve a hierarquia e os comportamentos descritos aqui, mesmo quando a página tiver conteúdo diferente.
6. Se uma decisão nova for necessária, registre-a na seção de decisões antes de introduzir um padrão paralelo.

Quando houver conflito entre uma tela antiga e este documento, a decisão mais recente registrada no changelog deve ser considerada a referência, mas a implementação deve ser revisada conscientemente. Não se deve mascarar uma divergência simplesmente criando mais uma exceção visual.

## 2. Intenção do produto

### 2.1 Quem usa o app

Uma diretora ou pessoa da equipe administrativa normalmente abre o app entre aulas, atendimentos e rotinas operacionais. Ela precisa resolver uma tarefa objetiva com pouco tempo e pouca margem para erro:

- consultar uma cobrança ou confirmar um pagamento;
- encontrar um aluno, responsável ou matrícula;
- verificar um evento, seus inscritos e seu resultado financeiro;
- registrar um custo ou receita;
- acompanhar a agenda e os compromissos da escola;
- agir sobre uma notificação operacional;
- consultar um relatório sem precisar navegar pela versão web.

### 2.2 O que a interface deve transmitir

A experiência deve ser:

- **calma:** superfícies claras, pouca competição visual e movimento discreto;
- **operacional:** cada informação deve ajudar a decidir ou executar uma ação;
- **confiável:** estados, valores, datas e consequências devem ser explícitos;
- **humana:** linguagem simples, contextualizada no cotidiano escolar;
- **coerente:** a mesma ação deve ter o mesmo lugar e comportamento em todo o app.

“Limpo” não significa remover contexto importante. Significa organizar a informação por prioridade e esconder complexidade avançada até ela ser necessária.

### 2.3 Exploração do domínio

O sistema visual nasce do domínio educacional da Alusa, não de um dashboard genérico.

**Conceitos do domínio:** escola, aluno, responsável, turma, matrícula, cobrança, evento, ingresso, agenda, operação e prestação de contas.

**Mundo de cores:** papel branco, cartões de aviso em cinza claro, tinta violeta escura, marcação verde para situação regular, âmbar para atenção e vermelho para risco ou erro. A cor de marca aparece como ação e orientação, não como decoração.

**Assinatura da Alusa:** informação operacional em cartões cinza, com cabeçalho objetivo, ícones discretos e ações contextuais acessíveis pelo lado direito. O sistema deve parecer uma ferramenta de trabalho escolar, não um painel financeiro genérico.

**Substituição de padrões genéricos:**

- substituir tabelas densas por listas de cartões com hierarquia de leitura;
- substituir páginas com muitos botões por uma ação primária e ações contextuais;
- substituir filtros permanentes grandes por busca e filtro no cabeçalho;
- substituir modais para fluxos completos por páginas, mantendo Bottom Sheets para escolhas e ações curtas;
- substituir excesso de cor por cinza estrutural e cor semântica apenas quando houver significado.

## 3. Princípios de interface

### 3.1 Ação primeiro

Cada tela deve responder rapidamente:

1. onde estou;
2. o que estou vendo;
3. qual é a próxima ação mais provável.

A ação principal deve ser visível sem competir com o conteúdo. Ações secundárias devem aparecer no contexto do item ou em um FAB quando forem recorrentes.

### 3.2 Hierarquia antes de ornamentação

Usar tamanho, peso, espaçamento e posição para organizar a leitura. Não usar cor, sombra ou ícones como substitutos de hierarquia textual.

### 3.3 Densidade adaptada à tarefa

- listas: densidade suficiente para comparar itens sem parecer uma tabela;
- detalhes: agrupamento por assunto, com respiro entre seções;
- formulários: uma ordem natural de preenchimento, sem campos avançados antes do essencial;
- scanner: máximo de área útil para a câmera e controles mínimos.

### 3.4 Estado sempre explícito

Uma cobrança, parcela, lançamento, ingresso ou notificação nunca deve depender apenas de uma cor. Sempre que possível, mostrar texto de status, valor, data e ação compatível.

### 3.5 Complexidade progressiva

O mobile expõe o que é necessário para a rotina. Configurações avançadas, ações destrutivas ou operações que exigem visão ampla permanecem protegidas, contextualizadas ou disponíveis na versão web quando essa for a decisão do produto.

### 3.6 Segurança e confiança

O app deve respeitar a conta ativa e o tenant em todas as consultas e mutações. A UI não deve sugerir que uma ação financeira foi concluída antes da confirmação do backend, webhook ou estado local confiável.

## 4. Tokens de design

Os valores abaixo refletem `apps/mobile/src/theme/tokens.ts` na última revisão. Alterações devem ser feitas primeiro no arquivo de tokens e depois refletidas nesta documentação.

### 4.1 Cores

| Token | Valor | Uso |
| --- | --- | --- |
| `ink` | `#140A2E` | texto primário, títulos, valores principais |
| `inkMuted` | `#665E73` | texto secundário, descrições, ícones neutros |
| `inkSubtle` | `#91899D` | placeholder, metadata, informação de baixa ênfase |
| `surface` | `#FFFFFF` | fundo de página clara, campos focados e superfícies elevadas |
| `surfaceSoft` | `#F7F3FB` | fundo suave estrutural quando a tela precisar de separação |
| `surfaceRaised` | `#FCFAFF` | superfície levemente destacada, como item não lido |
| `surfaceNeutral` | `#F5F5F5` | cartões Alusa, listas, campos neutros e estados vazios |
| `border` | `#E7DFF0` | bordas e divisores discretos |
| `brand` | `#3E1F63` | ação primária, foco, seleção e navegação ativa |
| `brandPressed` | `#2B1249` | estado pressionado da ação de marca |
| `brandSoft` | `#EEE5F8` | fundo de seleção, indicador ativo e ação secundária suave |
| `accent` | `#B8F000` | destaque positivo pontual, nunca para texto longo |
| `accentPressed` | `#9BD200` | estado pressionado do destaque |
| `accentSoft` | `#F1FFD2` | fundo de sucesso ou destaque positivo leve |
| `success` | `#1F7A4D` | pago, ativo, válido, em dia e operação concluída |
| `info` | `#123FE5` | informação e estados informativos |
| `warning` | `#B86800` | pendência, atenção, vencimento próximo |
| `danger` | `#B42318` | erro, atraso, exclusão e estado crítico |
| `dangerSoft` | `#FFE7E5` | fundo de erro ou ação destrutiva contextual |
| `white` | `#FFFFFF` | texto sobre marca e superfícies de alto contraste |
| `shadow` | `rgba(31, 14, 57, 0.18)` | base das sombras suaves |

#### Regras de cor

- O cartão padrão da Alusa é cinza claro: `surfaceNeutral`.
- Texto e ícones dentro dos cartões devem seguir a hierarquia de `ink`, `inkMuted` e `inkSubtle`.
- `brand` deve indicar ação, seleção ou navegação. Não usar violeta em toda informação só para criar contraste.
- Cores semânticas devem aparecer junto de uma descrição textual ou de uma ação clara.
- `danger` não deve ser usado para chamar atenção em elementos que não representam risco.
- Não usar hex avulso em novos componentes. Se uma cor for recorrente, ela deve virar token com nome de intenção.

### 4.2 Espaçamento

Base de 4 px:

| Token | Valor | Uso típico |
| --- | ---: | --- |
| `xs` | 4 | separação entre label e valor, ponto e texto |
| `sm` | 8 | gap curto, padding de badge e ações pequenas |
| `md` | 12 | gap entre conteúdo relacionado, padding de linhas compactas |
| `lg` | 16 | padding de componentes e separação padrão |
| `xl` | 24 | margem interna de página e cards principais |
| `2xl` | 32 | espaçamento de seções ou rodapé de sheet |
| `3xl` | 40 | respiro excepcional e topo de Bottom Sheet |

Regras:

- usar múltiplos da base de 4;
- preferir padding simétrico;
- usar `xl` como margem horizontal padrão de tela;
- usar `lg` como padding padrão de card;
- usar `md` em linhas e grupos relacionados;
- evitar espaçamentos negativos para corrigir desalinhamentos sem entender a causa.

### 4.3 Raios

| Token | Valor | Uso típico |
| --- | ---: | --- |
| `sm` | 8 | pequenos estados e controles compactos |
| `md` | 14 | campos de texto e cartões de formulário |
| `lg` | 22 | cards e listas principais |
| `xl` | 30 | hero cards, cards muito suaves e topo de sheets |
| `pill` | 999 | botões, badges, toggles e indicadores circulares |

O raio deve comunicar a função: controles e badges podem ser pill; cards de conteúdo devem usar raios grandes, mas não parecer botões.

### 4.4 Tipografia

Fonte: família nativa do sistema (`System` no iOS e a família padrão da plataforma nos demais ambientes).

| Variante | Tamanho | Line height | Uso |
| --- | ---: | ---: | --- |
| `display` | 34 | 38 | destaque excepcional, não para todo título |
| `heading` | 24 | 30 | título de página e cabeçalho de seção |
| `subheading` | 18 | 24 | título de card e seção secundária |
| `body` | 16 | 22 | conteúdo principal |
| `small` | 13 | 18 | descrição, label contextual e metadados importantes |
| `label` | 13 | 16 | label de campo |
| `tiny` | 11 | 14 | status compacto, legenda e informação auxiliar |

Pesos semânticos:

- `regular` / 400: corpo e descrições;
- `medium` / 600: títulos, labels e valores que precisam de ênfase;
- `bold` / 800: ações primárias, chamadas críticas e botões.

Não usar caixa alta em conteúdo comum. A caixa alta fica restrita ao texto de botões quando o componente padrão já a aplica.

### 4.5 Profundidade

A Alusa usa principalmente mudança de superfície e sombras suaves:

- página: `surface` ou `surfaceSoft`;
- card: `surfaceNeutral`;
- card destacado: `surfaceRaised` ou `brandSoft` quando houver seleção;
- sheet/modal: `surface` sobre backdrop escuro;
- dock e FAB: sombra suave para indicar flutuação;
- bordas: discretas, usando `border` ou `StyleSheet.hairlineWidth` quando forem apenas separação.

Sombras não devem substituir agrupamento. Se o usuário só entender uma seção por causa da sombra, a hierarquia de layout está insuficiente.

## 5. Estrutura de tela

### 5.1 Área segura e canvas

Todas as telas usam `Screen` e `SafeAreaView`. O conteúdo respeita as áreas seguras superior, lateral e inferior. A barra de navegação flutuante e FABs não podem cobrir conteúdo acionável.

Padrão:

- fundo claro por padrão;
- padding horizontal de `spacing.xl`;
- scroll vertical para conteúdo maior que a viewport;
- `keyboardShouldPersistTaps="handled"` em fluxos com busca e formulário;
- espaço inferior adicional quando houver dock, FAB ou botão fixo.

### 5.2 Cabeçalho padrão

O `PageHeader` deve ter:

- seta de voltar à esquerda;
- título alinhado à esquerda;
- ação contextual à direita quando necessário;
- altura mínima de 44 px;
- área de toque mínima confortável, mesmo que o ícone seja menor.

O título não deve ser centralizado artificialmente quando existe seta e ação lateral. A prioridade é a leitura e a coerência com as demais páginas.

### 5.3 Cabeçalho com busca e filtro

O `InlineSearchHeader` é o padrão para listas que precisam de pesquisa:

- estado fechado: título à esquerda, lupa à direita;
- ao tocar na lupa: o título sai e o input se expande horizontalmente no mesmo cabeçalho;
- animação curta e discreta de aproximadamente 220 ms;
- X fecha a pesquisa e limpa o texto quando esse for o comportamento da lista;
- filtro permanece como ícone no cabeçalho, com ponto indicador quando ativo;
- placeholder e texto usam a hierarquia de `inkMuted`/`inkSubtle`;
- o filtro abre um Bottom Sheet, não uma página intermediária, quando a seleção for curta.

Para “Todas as cobranças”, busca e filtro ficam ao lado direito do título, conforme a decisão específica da página. Não inserir uma barra de pesquisa grande abaixo do cabeçalho quando o padrão inline for aplicável.

### 5.4 Rodapé de navegação

O dock flutuante é reservado para destinos de alto nível, não para todas as páginas:

- Início;
- Relatório;
- Conta/perfil, quando habilitado;
- Todos.

O item ativo usa `brandSoft` e ícone `brand`. Itens inativos usam `inkSubtle`. O dock não deve aparecer sobre scanner, formulários focados ou páginas em que atrapalhe uma ação principal.

### 5.5 FAB

O FAB representa uma ação recorrente e primária daquela área. Deve ser:

- único por contexto;
- visualmente reconhecível;
- posicionado acima do dock e da área segura;
- aberto em menu curto quando houver mais de uma ação relacionada;
- acompanhado de labels claros quando a ação não for óbvia.

Padrões definidos:

- cobranças, avulsas, parcelamentos e assinaturas: FAB com uma única opção, **Criar cobrança**;
- detalhes de evento: menu contextual com ações operacionais permitidas;
- extrato/lançamentos: FAB de exportação ou ação específica apenas quando fizer sentido.

Não usar FAB para configurações raras ou destrutivas.

## 6. Componentes e contratos de uso

### 6.1 Texto

Usar `AppText` em vez de `Text` direto para manter cor, tamanho, line height e peso consistentes. Overrides locais devem ser pequenos e justificados pelo conteúdo, nunca para compensar um token inadequado.

### 6.2 Botões

O botão padrão tem altura mínima de 52 px, raio pill e padding horizontal `xl`.

- `primary`: ação principal violeta;
- `accent`: ação positiva/destaque quando o contraste e o contexto justificarem;
- `ghost`: ação secundária suave;
- `loading`: desabilita a ação e mostra indicador;
- `disabled`: reduz ênfase, sem parecer erro.

Botões devem usar verbos: “Salvar”, “Continuar”, “Tentar novamente”, “Registrar entrada”, “Finalizar evento”.

### 6.3 Campos

`TextField`, `SearchField`, `SelectField`, `DateField`, `ChoiceField`, `SegmentedToggle`, `OtpCodeField` e `EditableDataField` são os componentes preferenciais.

Regras:

- label antes do campo;
- ordem de preenchimento natural;
- placeholder explica formato, não substitui label;
- erro aparece próximo ao campo;
- loading e validação devem ocupar o slot de feedback à direita sem deslocar o texto;
- campo imutável deve ser visualmente reconhecível como não editável e não aceitar toque/digitação;
- valores monetários devem ter máscara e preservar o valor numérico real no envio;
- CPF/CNPJ podem ser inalteráveis, mas continuam apresentados em um campo visualmente consistente quando a página exige edição de outros dados.

### 6.4 Cards

O card padrão:

- fundo `surfaceNeutral`;
- raio `lg` ou `xl` conforme a importância;
- padding normalmente `lg` ou `xl`;
- alinhamento interno consistente entre label, valor, status e ação;
- texto principal `ink`, secundário `inkMuted`, metadata `inkSubtle`;
- ícone discreto, normalmente `inkMuted`;
- seta à direita quando o card é clicável;
- nenhuma informação essencial deve ficar apenas em tooltip ou cor.

Variações:

- **card de lista:** uma linha de conteúdo, avatar/ícone, texto e seta;
- **card de resumo:** valor principal, status e grade de detalhes;
- **card de ação:** ícone acima ou no início, label curta e área de toque ampla;
- **card de estado:** loading, vazio, erro ou sucesso com mensagem e ação contextual;
- **card financeiro:** tipo, descrição, valor, status e data em hierarquia previsível.

### 6.5 Bottom Sheet

O `BottomSheet` é a superfície correta para:

- filtros;
- seleções curtas;
- detalhes rápidos;
- registrar custo/receita;
- vincular figurino;
- notificações;
- confirmação de uma ação contextual.

Regras visuais e funcionais:

- sempre encostado no limite inferior da tela;
- não deixar faixa vazia abaixo do sheet;
- cantos superiores arredondados;
- handle central discreto;
- backdrop escuro e não interativo além de fechar ao tocar fora;
- conteúdo com padding interno coerente, sem empurrar a barra de rolagem para dentro do card;
- barra de rolagem alinhada à borda direita da viewport do sheet;
- deslize vertical para baixo fecha o sheet;
- gesto horizontal de campos e listas não deve ser capturado pelo gesto de fechar;
- em conteúdo longo, o scroll do conteúdo deve funcionar sem quebrar o gesto do handle;
- fechar por voltar do sistema deve ter o mesmo resultado do X e do gesto.

### 6.6 Estado vazio, loading e erro

Toda consulta deve possuir estados explícitos:

- `LoadingState`/skeleton para conteúdo esperado;
- `EmptyState` com explicação curta e ação quando houver próxima ação;
- `ErrorState` em página ou card, sem esconder a navegação;
- ação “Tentar novamente” deve repetir a consulta sem duplicar mutações;
- mensagens devem ser orientadas ao usuário, sem stack trace, token ou detalhe interno.

O erro de conexão deve ocupar o fluxo da própria página quando essa for a tela principal. Não transformar um erro de carregamento em modal se o usuário precisa continuar na mesma página.

## 7. Padrões de interação

### 7.1 Busca

- começar fechada, para preservar o título e reduzir ruído;
- abrir com animação horizontal;
- focar automaticamente o input quando possível;
- filtrar localmente apenas quando a fonte de dados já estiver carregada e o conjunto for seguro;
- usar serviço/API quando a busca for remota ou paginada;
- limpar a consulta ao fechar quando essa for a decisão da lista;
- mostrar estado vazio específico: “Nenhum aluno encontrado”, “Nenhuma cobrança encontrada” etc.;
- o estado vazio segue o padrão de card cinza da Alusa.

### 7.2 Filtros

- ícone no cabeçalho;
- ponto pequeno quando houver filtro ativo;
- opções agrupadas por dimensão útil para a tarefa;
- botão de limpar somente quando existir seleção;
- aplicar com feedback claro;
- preservar a seleção ao fechar quando o usuário aplicou o filtro;
- não transformar um filtro simples em formulário complexo.

### 7.3 Listas e paginação

Listas devem permitir comparação rápida e ter ação de toque previsível. Quando o volume crescer:

- usar paginação ou carregamento incremental conforme a API;
- manter o cabeçalho e os filtros estáveis;
- mostrar contador quando ele ajudar na orientação;
- evitar recarregar a lista inteira por causa de uma alteração local simples;
- preservar posição de scroll quando a operação não muda o conjunto;
- informar “fim da lista” apenas quando for necessário.

### 7.4 Edição

Dados pessoais e escolares seguem o padrão:

- estado inicial somente leitura, sem transformar toda informação em input;
- ícone de editar no cabeçalho ou na seção;
- ao entrar em edição, os campos editáveis ficam habilitados;
- o mesmo controle muda para “Salvar”;
- não manter um segundo botão redundante de salvar no fim da página;
- campos não editáveis permanecem bloqueados e não parecem clicáveis;
- ao voltar com alterações pendentes, mostrar o modal nativo “Deseja salvar as alterações?”;
- cancelar a saída retorna à edição sem perder dados;
- salvar mostra loading, trata erro e confirma sucesso.

### 7.5 Formulários e validação

O fluxo segue a ordem cognitiva:

1. identificar a entidade ou pessoa;
2. preencher o dado essencial;
3. adicionar detalhes complementares;
4. revisar;
5. confirmar.

Validar o mais cedo possível sem interromper a digitação. Para CEP:

- reconhecer a entrada conforme o usuário digita;
- mostrar loading no lado direito do campo;
- mostrar check quando válido;
- mostrar X e mensagem objetiva quando inválido;
- preencher endereço apenas com resposta confiável;
- permitir correção manual somente nos campos permitidos.

### 7.6 Gestos

Gestos devem ter alternativa acessível:

- deslizar Bottom Sheet para baixo fecha, mas X e voltar também fecham;
- deslizar notificação para a esquerda revela exclusão, mas a ação deve permanecer acessível ao leitor de tela;
- carrosséis têm scroll horizontal convencional e não devem capturar o gesto vertical;
- pressionar cards clicáveis não deve gerar movimento que pareça erro.

## 8. Módulos e fluxos consolidados

### 8.1 Página inicial

O topo contém:

- foto/perfil à esquerda;
- QR Code universal;
- sino de notificações;
- ajuda, quando disponível.

Abaixo ficam a busca, o resumo de boas-vindas, atalhos essenciais e módulos. “Alunos e turmas” não deve reaparecer como card de acesso rápido se a decisão for mantida; o acesso deve ocorrer pelo módulo correspondente.

### 8.2 Alunos e matrícula

- lista de alunos com busca inline, filtro quando necessário e seta no card;
- estado vazio em card cinza;
- detalhes do aluno;
- listagem de alunos matriculados em uma turma;
- detalhes da matrícula com dados acadêmicos, financeiros e ações de edição;
- dados pessoais e dados escolares seguindo o padrão de visualização/edição descrito acima.

Dados escolares não devem apresentar “status da conta” nem “perfil de acesso” quando esses dados não fizerem parte da finalidade escolar da tela.

### 8.3 Responsáveis

- lista de responsáveis com busca e filtro no cabeçalho;
- detalhes do responsável;
- dados consistentes com o cadastro real;
- ações de edição somente para campos permitidos pela API e pelas permissões.

### 8.4 Cobranças

Rotas e conceitos:

- todas as cobranças;
- cobranças avulsas;
- parcelamentos;
- assinaturas;
- detalhes de cobrança;
- criação de cobrança.

Padrões:

- FAB com uma única ação: “Criar cobrança”;
- busca e filtro no cabeçalho das listas;
- na página de todas as cobranças, busca/filtro ficam ao lado direito do título;
- cards mostram pagador, contexto, vencimento, valor e status;
- seta à direita indica navegação para detalhes;
- parcelamento mostra resumo e lista de parcelas; tocar em uma parcela abre os detalhes da cobrança;
- assinatura segue o mesmo padrão de resumo e cobranças recorrentes;
- status financeiro não deve ser alterado visualmente sem confirmação da fonte de dados confiável.

### 8.5 Eventos

O detalhe do evento organiza:

- resumo do evento;
- participantes/alunos inscritos;
- ingressos e check-in;
- resultado financeiro;
- lançamentos financeiros recentes, limitados inicialmente para reduzir carga cognitiva;
- botão “Ver todos” para a página completa de lançamentos;
- FAB de ações operacionais.

Ações do evento:

- **Registrar custo/receita:** fluxo unificado;
- **Vincular figurino:** seleção em campos/selects, com “vincular a” e “forma de cobrança”;
- **Finalizar evento:** substitui o nome “Encerrar evento”;
- **Reativar evento:** disponível quando o evento estiver finalizado;
- registrar cobranças, dar baixa manual e receber pagamentos continuam possíveis após finalização;
- venda de ingressos não fica disponível após finalização;
- finalizar evento não cancela cobranças do Asaas automaticamente.

Lançamentos financeiros:

- receita e custo usam o mesmo fluxo estrutural;
- o usuário informa descrição, valor e situação;
- pago/recebido registra a baixa e a data atual;
- pendente solicita uma data prevista;
- “venda de ingresso” não é categoria manual: possui fluxo próprio de tickets;
- taxa de inscrição é tratada como lançamento com restrição de ações no mobile quando o ajuste deve ocorrer na versão web;
- lista permite confirmar recebimento quando aplicável, editar ou cancelar;
- lançamentos devem preservar histórico e ter confirmação antes de ações irreversíveis.

### 8.6 Agenda

A agenda prioriza leitura por data e compromissos da escola:

- cabeçalho com período e navegação;
- seleção de dia com hierarquia clara;
- visão de compromissos em lista/timeline;
- cards com horário, título, tipo, local e contexto;
- filtros em Bottom Sheet;
- criação/edição somente para campos e ações suportados no mobile;
- funções que exigem visão ampla ou configuração avançada permanecem na web.

O layout deve ser minimalista: calendário e eventos são o conteúdo principal. Não adicionar atalhos “úteis” que não façam parte da tarefa de agenda.

### 8.7 Relatório

O título da página é **Relatório**. Não usar “Insights” como título principal.

O filtro fica no topo do cabeçalho como ícone, seguindo o padrão das demais listas. A tela pode reaproveitar os cards de insight da versão web quando eles ajudarem uma decisão operacional, especialmente:

- saúde da operação;
- visão financeira;
- cobranças em atraso;
- recebimentos e tendência;
- indicadores acadêmicos ou de matrícula quando existirem no contrato de dados.

O card de saúde da operação deve manter a linguagem visual da versão web, mas adaptada ao mobile: hierarquia curta, status explícito e leitura sem depender de gráficos densos.

### 8.8 Perfil, conta e segurança

A página de conta é organizada em:

1. cards quadrados menores de dados pessoais e dados escolares;
2. seção “Central de segurança” com cards retangulares para:
   - alterar senha;
   - token e autorização;
   - biometria/Face ID, quando disponível;
3. lista simples, sem divisórias pesadas, para:
   - central de ajuda;
   - sair do app.

Não exibir um terceiro card opcional na primeira sessão. “Sessões conectadas” foi removido do escopo atual.

Biometria:

- página simples com cabeçalho “Biometria”;
- um card com “Ativar Face ID” e toggle nativo;
- toggle centralizado verticalmente;
- texto auxiliar pequeno e cinza explicando segurança e conveniência;
- refletir estado real da autenticação local, sem afirmar que uma biometria está ativa antes da confirmação do dispositivo.

Alterar senha:

- wizard em etapas;
- código de verificação com um caractere por box;
- campo de OTP preparado para preenchimento automático quando a plataforma e o canal permitirem;
- expiração, reenvio e troca de método claramente indicados;
- sucesso e falha tratados sem revelar informação sensível.

### 8.9 Notificações internas

As notificações são internas da operação Alusa e seguem o mesmo modelo usado pela versão web.

- ícone de sino no topo da página inicial, ao lado do QR Code;
- indicador de não lidas é apenas um círculo pequeno, sem número;
- abertura em Bottom Sheet;
- título “Notificações” e subtítulo contextual;
- estado vazio com “Tudo certo por aqui”;
- cards cinza com padding consistente;
- barra colorida na lateral esquerda indica severidade e acompanha toda a altura útil do card, respeitando o raio e o padding interno;
- não mostrar lixeira permanentemente;
- arrastar o card para a esquerda revela a ação de excluir;
- excluir remove da caixa de entrada do usuário, preservando as regras de histórico do backend;
- toque em uma notificação pode marcá-la como lida;
- botão inferior marca todas como lidas quando houver itens não lidos.

### 8.10 QR Code universal

O QR Code universal é diferente do leitor específico de ingressos. Ele é aberto pelo ícone no topo da página inicial e identifica fluxos suportados pela Alusa, como PIX, cobrança e ticket de evento.

Tela do scanner:

- tela cheia;
- fundo real da câmera, sem card branco no recorte;
- área de leitura quadrada com transparência real e cantos arredondados;
- somente a área fora do recorte recebe overlay escuro;
- não criar círculos ou “bolas” nos cantos;
- não desenhar uma camada branca opaca sobre a área vazada;
- botão de voltar/sair;
- botão de ligar/desligar flash;
- mensagem curta “Aponte para um QR Code”;
- permissão de câmera com estado vazio e ação de solicitar permissão.

O leitor universal, nesta fase, reconhece QR Code. O leitor específico de ticket pode manter suas regras próprias de check-in. O resultado do universal usa uma página de resultado para fluxos completos, não um modal sobre o scanner.

O código externo do ingresso foi substituído por QR Code no ticket. A resolução deve identificar o evento e o ingresso a partir do conteúdo do QR; não pedir seleção manual de evento como fallback para códigos antigos ou ambíguos.

## 9. Estados e mensagens

### 9.1 Linguagem

Usar português simples e verbos de ação. Exemplos:

- “Nenhum aluno encontrado”;
- “Não foi possível carregar”;
- “Tentar novamente”;
- “Salvar”;
- “Finalizar evento”;
- “Reativar evento”;
- “Registrar custo/receita”;
- “Ler outro QR Code”.

Evitar mensagens técnicas como “request failed”, “undefined”, “payload inválido” ou nomes internos de APIs.

### 9.2 Status semântico

| Situação | Cor preferencial | Exemplo |
| --- | --- | --- |
| positivo | `success` / `accentSoft` | Pago, Ativa, Em dia, Ingresso válido |
| atenção | `warning` | Pendente, vencimento próximo |
| crítico | `danger` / `dangerSoft` | Atrasado, erro, ingresso indisponível |
| informativo | `info` | Atualização, processamento |
| neutro | `inkMuted` / `surfaceNeutral` | Cancelado, sem informação |

O status sempre deve ter texto. Dots e barras coloridas são complementares.

### 9.3 Loading

O loading deve ocupar a área do conteúdo sem deslocar bruscamente o cabeçalho. Usar skeleton quando a estrutura for conhecida e ActivityIndicator para uma ação pontual.

### 9.4 Erros

Erros de rede devem preservar a página, permitir retry e não destruir filtros ou dados já digitados. Erros de validação devem ficar no campo ou no grupo responsável. Erros de mutação devem informar se nada foi salvo ou se é necessário conferir o estado atual.

## 10. Acessibilidade

- toda ação deve ter `accessibilityRole` adequado;
- labels devem descrever a ação, não apenas o ícone;
- hit slop deve ser usado em controles pequenos;
- texto não pode depender somente da cor;
- campos devem ter label e mensagem de erro associados;
- estados busy, disabled e selected devem ser expostos;
- gestos devem ter alternativa por botão ou ação de acessibilidade;
- respeitar fonte dinâmica sempre que o layout permitir;
- não colocar elementos importantes atrás do dock, FAB, teclado ou safe area;
- manter contraste suficiente entre texto e fundo;
- evitar truncar o único dado que identifica uma pessoa, cobrança ou evento.

## 11. Regras de dados e integração

Este documento descreve a interface, mas a interface não pode violar as regras do produto:

- toda operação é escopada à `Conta` ativa;
- o client não decide livremente `contaId`;
- regras acadêmicas ficam em camadas de domínio/caso de uso;
- regras financeiras e integrações Asaas não devem ser duplicadas em componentes;
- o estado local deve refletir fonte confiável, webhook ou reconciliação;
- ações financeiras relevantes devem ser idempotentes e auditáveis;
- uma confirmação visual só deve aparecer depois de uma resposta consistente;
- o app não expõe API keys, tokens ou detalhes internos;
- erros do backend devem ser traduzidos para mensagens seguras.

## 12. Inventário de páginas mobile

Rotas relevantes atualmente organizadas no app:

### Operação e navegação

- `(app)/index.tsx` — início;
- `(app)/todos.tsx` — módulos gerais;
- `(app)/search.tsx` — busca global;
- `(app)/report.tsx` — relatório;
- `(app)/account.tsx` — conta/perfil;
- `(app)/profile.tsx` — perfil;
- `(app)/biometrics.tsx` — biometria;
- `(app)/change-password.tsx` — alterar senha.

### Educação

- `(app)/students.tsx` — alunos;
- `(app)/students/[studentId].tsx` — detalhes do aluno;
- `(app)/students/[studentId]/edit.tsx` — edição do aluno;
- `(app)/enrollments.tsx` — matrículas;
- `(app)/enrollments/[classId].tsx` — alunos matriculados na turma;
- `(app)/enrollments/detail/[enrollmentId].tsx` — detalhes da matrícula;
- `(app)/personal-data.tsx` — dados pessoais;
- `(app)/school-data.tsx` — dados escolares;
- `(app)/responsaveis.tsx` — responsáveis;
- `(app)/responsaveis/[responsibleId].tsx` — detalhes do responsável;
- `(app)/responsaveis/[responsibleId]/edit.tsx` — edição do responsável;
- `(app)/responsaveis/[responsibleId]/notifications.tsx` — notificações relacionadas.

### Financeiro

- `(app)/billing.tsx` — todas as cobranças;
- `(app)/billing-charges.tsx` — listagem financeira;
- `(app)/avulsas.tsx` — cobranças avulsas;
- `(app)/parcelamentos.tsx` — parcelamentos;
- `(app)/parcelamentos/[installmentId].tsx` — detalhes do parcelamento;
- `(app)/assinaturas.tsx` — assinaturas;
- `(app)/assinaturas/[subscriptionId].tsx` — detalhes da assinatura;
- `(app)/billing/create.tsx` — criar cobrança;
- `(app)/billing/[chargeId].tsx` — detalhes da cobrança;
- `(app)/billing/[chargeId]/edit.tsx` — editar cobrança;
- `(app)/billing/[chargeId]/edit-rules.tsx` — regras de edição;
- `(app)/statement.tsx` — extrato.

### Agenda e eventos

- `(app)/agenda.tsx` — agenda;
- `(app)/agenda/create.tsx` — criar item de agenda;
- `(app)/agenda/attendance/[eventId].tsx` — presença;
- `(app)/events.tsx` — eventos;
- `(app)/events/[eventId].tsx` — detalhes do evento;
- `(app)/events/[eventId]/participants.tsx` — inscritos;
- `(app)/events/[eventId]/financial.tsx` — lançamentos financeiros;
- `(app)/ticket-scanner.tsx` — leitor específico de ingressos;
- `(app)/universal-qr-scanner.tsx` — leitor universal.

## 13. Checklist de revisão UI/UX

Antes de considerar uma tela pronta:

### Hierarquia e layout

- [ ] o título identifica claramente a página;
- [ ] a seta de voltar está alinhada e tem área de toque confortável;
- [ ] conteúdo não começa colado no status bar;
- [ ] margens laterais seguem o padrão da tela;
- [ ] cards têm padding simétrico e alinhamento interno consistente;
- [ ] a ação principal está evidente;
- [ ] FAB/dock não cobrem conteúdo;
- [ ] Bottom Sheet encosta no limite inferior sem espaço vazio;
- [ ] barra de rolagem fica na borda da viewport, não sobre o conteúdo;
- [ ] não há elementos flutuando sem função clara.

### Visual

- [ ] cores vêm dos tokens;
- [ ] fundo de card é `surfaceNeutral` quando o padrão for card Alusa;
- [ ] texto e ícones seguem a mesma hierarquia da tela principal;
- [ ] status tem texto além da cor;
- [ ] sombras são discretas e consistentes;
- [ ] raios estão adequados à função;
- [ ] não existem divisórias pesadas em listas que podem usar agrupamento e espaço.

### Comportamento

- [ ] busca abre no cabeçalho com expansão horizontal;
- [ ] filtro mostra indicador quando ativo;
- [ ] cards clicáveis têm seta à direita;
- [ ] estados de loading, vazio, erro e sucesso existem;
- [ ] ações destrutivas têm confirmação ou undo apropriado;
- [ ] gestos têm alternativa por botão;
- [ ] mudanças não salvas são protegidas;
- [ ] retry não duplica mutações;
- [ ] paginação mantém filtros e posição de forma previsível.

### Dados e segurança

- [ ] a tela usa a conta/tenant correto;
- [ ] nenhum dado vazio é apresentado como preenchido;
- [ ] campos imutáveis não aceitam edição;
- [ ] valores monetários têm máscara e valor de envio correto;
- [ ] operações financeiras não são confirmadas antes do estado confiável;
- [ ] mensagens não expõem detalhes internos.

### Acessibilidade

- [ ] todos os ícones acionáveis têm label;
- [ ] estados selecionado, ocupado e desabilitado são anunciados;
- [ ] o fluxo não depende apenas de gesto ou cor;
- [ ] campos e erros são compreensíveis pelo leitor de tela;
- [ ] áreas de toque são confortáveis;
- [ ] conteúdo continua utilizável com fonte maior.

## 14. Decisões consolidadas

| Tema | Decisão |
| --- | --- |
| Documento canônico | Um `apps/mobile/SYSTEM.md`, com Design System, UX e comportamento |
| Identidade visual | Cinza claro nos cards, violeta escuro no texto principal e marca, ícones discretos |
| Busca | Lupa no cabeçalho; título desaparece e input expande horizontalmente |
| Filtro | Ícone no cabeçalho com ponto pequeno quando ativo |
| Cards clicáveis | Seta no lado direito |
| Estado vazio | Card cinza no padrão Alusa |
| Cobranças | FAB único “Criar cobrança” nas listagens principais |
| Parcelamentos | Resumo + lista de parcelas; toque abre detalhes da cobrança |
| Assinaturas | Mesmo padrão estrutural dos parcelamentos |
| Eventos | Lançamentos recentes limitados + página “Ver todos” |
| Evento finalizado | Pode receber pagamentos, registrar cobranças e custos/receitas; não vende ingressos |
| Ação de finalização | Nome “Finalizar evento”; pode “Reativar evento” |
| Custo/receita | Fluxo unificado; pago/recebido baixa na data atual; pendente pede data prevista |
| Venda de ingresso | Fluxo próprio; não é categoria manual de receita |
| Taxa de inscrição | Ações restritas no mobile quando o ajuste exigir a versão web |
| Bottom Sheet | Encosta no rodapé, tem gesto de arrastar para baixo e scroll correto |
| Notificações | Sino com ponto, sheet, barra de severidade lateral, swipe para excluir |
| QR universal | Tela cheia, câmera, flash, saída e recorte transparente arredondado |
| QR de ingresso | Identifica ingresso/evento automaticamente; sem seleção manual de evento |
| Ticket | Código externo substituído por QR Code |
| Perfil | Dados pessoais e escolares em cards quadrados; segurança em cards retangulares |
| Biometria | Um toggle nativo de Face ID e texto auxiliar |
| Sessões conectadas | Fora do escopo atual |
| Edição | Ícone alterna para “Salvar”; modal nativo protege alterações não salvas |

## 15. O que não fazer

- não criar um segundo sistema de cores para uma nova feature;
- não transformar cada informação em um card separado;
- não colocar uma barra de busca fixa abaixo do cabeçalho quando a busca inline for suficiente;
- não usar modal para um fluxo completo que precisa de navegação, scroll ou revisão;
- não usar Bottom Sheet com espaço vazio no rodapé;
- não colocar lixeira visível permanentemente em notificações;
- não usar número no indicador de notificação quando o padrão definido é apenas ponto;
- não adicionar seleção manual de evento ao leitor universal;
- não permitir digitação em campos imutáveis;
- não mostrar dados vazios como se fossem reais;
- não confirmar ações financeiras somente porque o botão foi tocado;
- não colocar ações avançadas ou de desktop em uma tela mobile sem avaliar carga cognitiva;
- não criar componente duplicado antes de verificar `src/components` e `src/features`;
- não usar `any`, `ts-ignore`, casts inseguros ou desabilitar validações para esconder inconsistências.

## 16. Pendências e pontos de atenção

Esta seção mantém decisões que ainda precisam de validação de produto ou auditoria técnica:

- revisar eventuais valores de estilo fora dos tokens, como backgrounds hardcoded em componentes existentes;
- validar visualmente o recorte transparente do scanner em iOS e Android reais;
- confirmar contratos finais de paginação para todas as listas remotas;
- validar a matriz de permissões para editar dados pessoais, escolares, responsáveis e lançamentos;
- confirmar quais insights da versão web têm dados mobile estáveis;
- revisar o comportamento de notificações quando uma notificação é lida, arquivada ou excluída;
- validar suporte de autofill de OTP por canal e plataforma;
- revisar páginas que ainda usam nomenclatura ou layout anterior ao padrão deste documento.

Pendências devem ser resolvidas com uma decisão explícita e removidas desta lista quando implementadas e validadas.

## 17. Changelog de decisões

### 14/09/2026

- criado o sistema consolidado do mobile;
- documentados tokens, componentes e padrões visuais existentes;
- consolidados os comportamentos de busca, filtros, cards, FABs, Bottom Sheets, notificações, eventos, financeiro, perfil e QR Code;
- definido este arquivo como fonte de verdade da experiência mobile.

---
applyTo: 'apps/site/src/components/visual/**,apps/site/src/components/sections/**'
---

## Regra: previews de componentes reais do sistema Alusa

Use previews quando uma secao do site publico precisar mostrar, de forma visual e persuasiva, um componente real do produto Alusa sem transformar a landing page em uma captura literal do app.

Esses previews devem parecer partes vivas do sistema: cards, tabelas, sidebars, dashboards, listas e estados reais da interface. O objetivo e dar contexto visual do produto, nao criar ilustracoes genericas.

## Estrutura recomendada

Todo preview deve separar tres camadas:

1. **Mascara externa**
   - Container responsavel por borda, raio, sombra, fundo e `overflow-hidden`.
   - E a area que cria a sensacao de crop.
   - Deve controlar o enquadramento do preview, nao o tamanho real do componente interno.

2. **Superficie interna**
   - Elemento maior do que a mascara quando a intencao for parecer um recorte do sistema.
   - Pode ultrapassar o limite da mascara usando largura fixa, `min-width`, deslocamento negativo ou posicionamento absoluto.
   - Nao deve ficar preso ao padding da pagina quando a proposta visual for mostrar o componente cortado.

3. **Componente simulado**
   - Reproducao fiel do componente real da Alusa: tabela, card, dashboard, sidebar, lista, KPI ou fluxo.
   - Deve usar conteudo representativo, curto e legivel.
   - Deve evitar texto lorem ipsum, mockups abstratos ou elementos que nao existam no produto.

## Boas praticas de UI/UX

- O preview deve ajudar a explicar a promessa da secao. Se a copy fala de financeiro, o preview deve mostrar cobrancas, pagamentos, recorrencia, status ou valores.
- Prefira componentes reais ou muito proximos do app atual em vez de cards genericos.
- Mantenha a hierarquia visual do sistema: titulo, acoes, cabecalho, linhas, status, valores e estados.
- Use no maximo a quantidade de dados necessaria para comunicar a ideia. Em cards/tabelas de preview, 3 a 5 linhas costumam ser suficientes.
- Use dados realistas, mas ficticios. Nao usar informacoes sensiveis ou dados reais de clientes.
- Evite excesso de detalhes interativos. O preview e demonstrativo; botoes podem ser visuais e receber `tabIndex={-1}` quando nao devem entrar na navegacao por teclado.
- O preview deve parecer produto, nao decoracao. Evite gradientes ornamentais, ilustracoes abstratas e elementos que tirem foco da interface.
- Preserve contraste, legibilidade e espacamento mesmo quando o componente estiver parcialmente cortado.
- O crop deve parecer intencional: corte lateral, inferior ou superior com composicao clara. Nao cortar textos essenciais de forma acidental.

## Mascara e crop

- Use `overflow-hidden` somente na camada de mascara.
- A superficie interna pode ser maior que a mascara (`min-w`, largura fixa ou posicao absoluta) para gerar a sensacao de recorte.
- Quando o preview precisa atravessar a margem da pagina, aplique deslocamento no wrapper do preview, por exemplo `lg:-mr-*`, e nao no container global da secao.
- A borda e a sombra devem pertencer a mascara, quando a intencao for mostrar um frame de preview.
- A sombra da superficie real do sistema pode existir dentro da mascara quando o componente simulado tiver uma card shell propria.
- Evite colocar `overflow-hidden` em pais acima da secao se isso impedir o crop desejado.

## Fidelidade ao sistema Alusa

- Antes de criar um preview novo, consultar componentes reais em `apps/web` quando houver equivalente.
- Copiar linguagem visual do sistema: raios, paddings, pesos de fonte, cores de status, bordas, avatares, linhas de tabela e botoes.
- Para dashboard/sidebar, manter menus, estados ativos, logo e densidade visual proximos do app real.
- Para tabelas financeiras, manter a estrutura familiar: titulo, acao principal, colunas, avatar/nome, vencimento, status e valor.
- Usar tokens/classes existentes quando possivel. Se o site precisar de um valor especifico do sistema, centralize no componente visual em vez de espalhar estilos soltos por varias secoes.

## Responsividade

- Em desktop, previews podem ser largos, deslocados e parcialmente cortados para sugerir uma tela maior do sistema.
- Em mobile, nao forcar tabelas largas dentro da viewport sem criterio.
- Se o preview perder legibilidade no mobile, esconda, simplifique ou transforme em um card compacto.
- Nao permitir scroll horizontal global da pagina. O crop deve ficar contido na mascara ou na secao.
- Textos dentro do preview nao devem quebrar de forma incoerente ou sobrepor colunas.

## Regras de implementacao

- Criar previews reutilizaveis em `apps/site/src/components/visual`.
- A secao deve apenas posicionar o preview; a estrutura visual do mock deve ficar encapsulada no componente de preview.
- Nao misturar dados/copy da landing page com detalhes internos do preview, exceto quando a secao realmente controlar o conteudo.
- Manter os dados mockados pequenos e tipados com `readonly` quando forem constantes.
- Rodar antes de concluir:

```bash
pnpm --filter @alusa/site typecheck
pnpm --filter @alusa/site lint
```

## Exemplos de referencia

- Preview de dashboard: usar mascara externa com crop de uma superficie maior, sidebar realista e conteudo interno do sistema.
- Preview de cobrancas: usar box de preview com tabela realista de "Ultimas Cobrancas", quatro alunos, status e valores no estilo do produto.



# Introdução

Encontre guias para integrar as APIs financeiras do Asaas.

> 📘
>
> Está procurando pela referência da API? [Clique aqui](https://asaas.readme.io/reference) para ver todos os detalhes dos nossos endpoints.

Com nossa API, além de acesso a uma Conta Digital completa, você pode automatizar seus processos de cobrança, recebimento e pagamento de forma fácil e segura, utilizando várias formas de pagamento: **PIX, boleto bancário, cartão de crédito e débito e TED**. Além disso, oferecemos várias funcionalidades para impulsionar seu negócio: régua de cobrança e notificações automáticas, link de pagamento, split de pagamentos, gestão de assinaturas, cofre de cartão de crédito, antecipação de recebíveis, webhooks e muito mais.

Somos uma Instituição de Pagamento e SCD **autorizada e regulada pelo Banco Central do Brasil**. Também somos certificados **PCI-DSS**, garantindo mais segurança nas suas transações.

Nesta documentação você encontrará guias e exemplos para auxiliá-lo no processo de integração e tirar quaisquer dúvidas durante o desenvolvimento.

Caso tenha dúvidas não sanadas por esta documentação, [entre em contato com nosso suporte](https://docs.asaas.com/docs/entre-em-contato).

## Crie uma conta Asaas

Para testar os exemplos aqui descritos é necessário ter uma conta. Caso você ainda não tenha uma, basta criar uma [clicando aqui](https://asaas.com/onboarding/createAccount?customerSignUpOriginChannel=DOCUMENTATION) ou [aqui para criar em nossa sandbox](https://sandbox.asaas.com/onboarding/createAccount).

<Embed url="https://www.youtube.com/watch?v=3TEclkugpkE" favicon="http://www.google.com/favicon.ico" image="http://i.ytimg.com/vi/3TEclkugpkE/hqdefault.jpg" provider="youtube.com" href="https://www.youtube.com/watch?v=3TEclkugpkE" typeOfEmbed="youtube" title="undefined" html="%3Ciframe%20class%3D%22embedly-embed%22%20src%3D%22%2F%2Fcdn.embedly.com%2Fwidgets%2Fmedia.html%3Fsrc%3Dhttps%253A%252F%252Fwww.youtube.com%252Fembed%252F3TEclkugpkE%26display_name%3DYouTube%26url%3Dhttps%253A%252F%252Fwww.youtube.com%252Fwatch%253Fv%253D3TEclkugpkE%26image%3Dhttp%253A%252F%252Fi.ytimg.com%252Fvi%252F3TEclkugpkE%252Fhqdefault.jpg%26key%3D7788cb384c9f4d5dbbdbeffd9fe4b92f%26type%3Dtext%252Fhtml%26schema%3Dyoutube%22%20width%3D%22854%22%20height%3D%22480%22%20scrolling%3D%22no%22%20title%3D%22YouTube%20embed%22%20frameborder%3D%220%22%20allow%3D%22autoplay%3B%20fullscreen%3B%20encrypted-media%3B%20picture-in-picture%3B%22%20allowfullscreen%3D%22true%22%3E%3C%2Fiframe%3E" />

### Vamos começar?

<HTMLBlock>
  {`
  <style>
    .cards-list-asaas {
      display: flex;
      gap: 16px;
    }
    
    .card-asaas {
    	display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid rgb(227, 232, 237); 
      border-radius: 8px;
    }
    
    .card-asaas img {
     	border-radius: 8px 8px 0 0;
    }
    
    .card-asaas div {
      padding:16px;
    }
    
    @media (max-width: 600px) {
      .cards-list-asaas {
      	flex-direction: column;
      }
  	}
  </style>

  <div class="cards-list-asaas">
    <div class="card-asaas">
      <a href="https://docs.asaas.com/docs/sandbox">
        <img src="https://files.readme.io/bfcafbd-sandbox.png" />
      </a>
      <div>
        <strong>Sandbox</strong>
        <p>Utilize nosso ambiente de testes para que nada saia fora do esperado antes de entrar em produção.</p>
      </div>
    </div>
    <div class="card-asaas">
      <a href="https://docs.asaas.com/docs/criando-um-cliente">
    		<img src="https://files.readme.io/b0c00dc-cobrancas.png" />
      </a>
      <div>
        <strong>Fluxo de cobranças</strong>
        <p>Comece o passo a passo, desde a criação de um cliente e siga para criação de cobranças.</p>
      </div>
    </div>
    <div class="card-asaas">
    	<a href="https://docs.asaas.com/docs/sobre-os-webhooks">	
      	<img src="https://files.readme.io/27cad02-webhooks.png" />
      </a>
      <div>
        <strong>Webhooks</strong>
        <p>Mantenha sua aplicação em dia com os eventos que o Asaas irá enviar.</p>
      </div>
    </div>
  </div>
  `}
</HTMLBlock>

### Comunidade para devs

Fique por dentro das principais novidades da nossa API em nossos canais criados pela área de Developer Relations do Asaas:

* [Conheça o portal de desenvolvedores](https://asaas.com/developers)
* [Inscreva-se e receba novidades por e-mail](https://materiais.asaas.com/developers)
* [Entre para nossa comunidade no Discord](https://discord.gg/invite/X2kgZm69HV)

### Status Page

É possível checar a disponibilidade de nossos serviços através de nossa página de Status. A mesma pode ser acessada em [https://status.asaas.com/](https://status.asaas.com/)

### Suporte

Se mesmo após ler a documentação restarem dúvidas ou encontrar algum problema, [entre em contato com nosso time de sucesso de integração](https://docs.asaas.com/docs/entre-em-contato).
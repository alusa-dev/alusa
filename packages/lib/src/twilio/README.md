# Módulo Twilio - Integração WhatsApp e SMS

Módulo centralizado para envio de mensagens WhatsApp e SMS via Twilio API.

## 📋 Sumário

- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso Básico](#uso-básico)
- [API Reference](#api-reference)
- [Exemplos Avançados](#exemplos-avançados)
- [Tratamento de Erros](#tratamento-de-erros)
- [Testes](#testes)
- [Melhores Práticas](#melhores-práticas)

## 🚀 Instalação

Este módulo já está incluído no workspace. Certifique-se de ter as dependências instaladas:

```bash
pnpm install
```

## ⚙️ Configuração

### Variáveis de Ambiente

Configure as seguintes variáveis no seu `.env`:

```env
# Obrigatórias
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=whatsapp:+14155238886  # Seu número Twilio

# Método 1: Auth Token (simples)
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Método 2: API Key (recomendado, mais seguro)
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Obter Credenciais Twilio

1. Acesse [console.twilio.com](https://console.twilio.com)
2. **Account SID** e **Auth Token**: na página principal do dashboard
3. **API Key** (recomendado):
   - Settings → API Keys → Create API Key
   - Salve o SID e Secret (não será mostrado novamente)
4. **From Number**:
   - Phone Numbers → WhatsApp Senders
   - Use o formato: `whatsapp:+[número]`

## 📖 Uso Básico

### Enviar Mensagem WhatsApp

```typescript
import { getTwilioService } from '@/lib/twilio';

const twilioService = getTwilioService();

const result = await twilioService.sendMessage({
  numero: '11987654321',
  mensagem: 'Olá! Bem-vindo ao Alusa 🎉',
  tipo: 'whatsapp',
});

if (result.success) {
  console.log('✅ Mensagem enviada:', result.data?.sid);
} else {
  console.error('❌ Erro:', result.error?.message);
}
```

### Enviar SMS

```typescript
const result = await twilioService.sendMessage({
  numero: '11987654321',
  mensagem: 'Sua matrícula foi confirmada!',
  tipo: 'sms',
});
```

### Criar Serviço Customizado

```typescript
import { TwilioService } from '@/lib/twilio';

const service = new TwilioService({
  accountSid: 'ACxxx',
  apiKeySid: 'SKxxx',
  apiKeySecret: 'secret',
  fromNumber: 'whatsapp:+14155238886',
  debug: true,
});
```

## 📚 API Reference

### `TwilioService`

#### `sendMessage(input: SendMessageInput): Promise<SendMessageResult>`

Envia mensagem WhatsApp ou SMS.

**Parâmetros:**

```typescript
interface SendMessageInput {
  numero: string; // Número do destinatário (qualquer formato)
  mensagem?: string; // Conteúdo da mensagem (opcional)
  tipo?: 'whatsapp' | 'sms'; // Default: 'whatsapp'
}
```

**Retorno:**

```typescript
interface SendMessageResult {
  success: boolean;
  data?: TwilioMessageResponse;
  error?: TwilioError;
  timestamp: Date;
}
```

**Exemplo:**

```typescript
const result = await service.sendMessage({
  numero: '(11) 98765-4321',
  mensagem: 'Olá!',
});
```

---

#### `listMessages(params?: ListMessagesParams): Promise<MessageHistory[]>`

Lista mensagens enviadas/recebidas.

**Parâmetros:**

```typescript
interface ListMessagesParams {
  to?: string; // Filtrar por destinatário
  from?: string; // Filtrar por remetente
  dateSent?: Date | string; // Filtrar por data
  pageSize?: number; // Quantidade de resultados (default: 50)
  page?: number; // Página (default: 0)
}
```

**Exemplo:**

```typescript
const messages = await service.listMessages({
  to: 'whatsapp:+5511987654321',
  pageSize: 20,
});
```

---

#### `getMessage(sid: string): Promise<TwilioMessageResponse>`

Busca detalhes de uma mensagem específica.

**Exemplo:**

```typescript
const message = await service.getMessage('SM1234567890abcdef');
```

---

#### `getBalance(): Promise<string>`

Retorna saldo da conta Twilio.

**Exemplo:**

```typescript
const balance = await service.getBalance();
console.log('Saldo:', balance); // '15.75'
```

---

#### `testConnection(): Promise<boolean>`

Testa conexão com a API Twilio.

**Exemplo:**

```typescript
const isOk = await service.testConnection();
```

---

### Funções Auxiliares

#### `formatarNumeroWhatsApp(numero: string): string`

Formata número para padrão WhatsApp.

```typescript
import { formatarNumeroWhatsApp } from '@/lib/twilio';

formatarNumeroWhatsApp('11987654321');
// → 'whatsapp:+5511987654321'

formatarNumeroWhatsApp('(11) 98765-4321');
// → 'whatsapp:+5511987654321'
```

#### `formatarNumeroSMS(numero: string): string`

Formata número para padrão SMS.

```typescript
import { formatarNumeroSMS } from '@/lib/twilio';

formatarNumeroSMS('11987654321');
// → '+5511987654321'
```

#### `parsePhoneNumber(numero: string): PhoneNumber | null`

Extrai partes do número de telefone.

```typescript
import { parsePhoneNumber } from '@/lib/twilio';

const parsed = parsePhoneNumber('5511987654321');
// {
//   countryCode: '55',
//   areaCode: '11',
//   localNumber: '987654321',
//   e164: '+5511987654321',
//   national: '(11) 98765-4321'
// }
```

#### `isValidTwilioNumber(numero: string): boolean`

Valida se número está formatado corretamente.

```typescript
isValidTwilioNumber('whatsapp:+5511987654321'); // true
isValidTwilioNumber('11987654321'); // false
```

#### `calculateSmsSegments(mensagem: string): number`

Calcula quantos segmentos SMS serão necessários.

```typescript
calculateSmsSegments('Mensagem curta'); // 1
calculateSmsSegments('Mensagem muito longa...'.repeat(10)); // 3
```

## 🔍 Exemplos Avançados

### Enviar Mensagem com Tratamento de Erro

```typescript
async function enviarMensagemSegura(numero: string, mensagem: string) {
  const service = getTwilioService();

  try {
    const result = await service.sendMessage({ numero, mensagem });

    if (!result.success) {
      throw new Error(result.error?.message || 'Falha no envio');
    }

    return result.data;
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    throw error;
  }
}
```

### Enviar para Múltiplos Destinatários

```typescript
async function enviarParaVarios(numeros: string[], mensagem: string) {
  const service = getTwilioService();

  const results = await Promise.allSettled(
    numeros.map((numero) => service.sendMessage({ numero, mensagem })),
  );

  const sucessos = results.filter((r) => r.status === 'fulfilled');
  const falhas = results.filter((r) => r.status === 'rejected');

  return { sucessos: sucessos.length, falhas: falhas.length };
}
```

### Agendar Envio (com validação)

```typescript
async function agendarMensagem(numero: string, mensagem: string, quando: Date) {
  const agora = new Date();

  if (quando < agora) {
    throw new Error('Data/hora deve ser futura');
  }

  const delay = quando.getTime() - agora.getTime();

  setTimeout(async () => {
    const service = getTwilioService();
    await service.sendMessage({ numero, mensagem });
  }, delay);
}
```

### Consultar Histórico Filtrado

```typescript
async function buscarMensagensHoje() {
  const service = getTwilioService();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const messages = await service.listMessages({
    dateSentAfter: hoje,
    pageSize: 100,
  });

  return messages;
}
```

## ⚠️ Tratamento de Erros

### Códigos de Erro Comuns

| Código | Descrição                    | Solução                                |
| ------ | ---------------------------- | -------------------------------------- |
| 20003  | Falha na autenticação        | Verifique Account SID e Auth Token     |
| 21211  | Número inválido              | Formate o número corretamente          |
| 21408  | Número não verificado        | Verifique o número no console Twilio   |
| 30003  | Falha na entrega             | Verifique se o número existe           |
| 63016  | WhatsApp número não aprovado | Aguarde aprovação do número no console |

### Usando `getFriendlyErrorMessage`

```typescript
import { getFriendlyErrorMessage } from '@/lib/twilio';

try {
  await service.sendMessage({ numero: 'invalido' });
} catch (error) {
  if (error.code) {
    const mensagem = getFriendlyErrorMessage(error.code);
    console.error(mensagem);
  }
}
```

## 🧪 Testes

### Executar Testes Unitários

```bash
pnpm --filter @alusa/lib test:unit
```

### Exemplo de Teste

```typescript
import { formatarNumeroWhatsApp } from '@/lib/twilio';

describe('formatarNumeroWhatsApp', () => {
  it('deve formatar número brasileiro', () => {
    const result = formatarNumeroWhatsApp('11987654321');
    expect(result).toBe('whatsapp:+5511987654321');
  });

  it('deve lançar erro para número inválido', () => {
    expect(() => formatarNumeroWhatsApp('123')).toThrow();
  });
});
```

## ✅ Melhores Práticas

### 1. Use API Key ao invés de Auth Token

```typescript
// ❌ Não recomendado
TWILIO_AUTH_TOKEN = xxx;

// ✅ Recomendado
TWILIO_API_KEY_SID = SKxxx;
TWILIO_API_KEY_SECRET = xxx;
```

### 2. Sempre Valide Números Antes de Enviar

```typescript
import { formatarNumeroWhatsApp } from '@/lib/twilio';

try {
  const numeroFormatado = formatarNumeroWhatsApp(input);
  // Continuar com envio...
} catch (error) {
  // Número inválido
  return { error: 'Número de telefone inválido' };
}
```

### 3. Trate Erros Adequadamente

```typescript
const result = await service.sendMessage({ numero, mensagem });

if (!result.success) {
  // Log para debug
  console.error('[Twilio]', result.error);

  // Mensagem amigável para usuário
  return { error: 'Não foi possível enviar a mensagem. Tente novamente.' };
}
```

### 4. Use Debug Mode em Desenvolvimento

```typescript
const service = new TwilioService({
  // ...outras configs
  debug: process.env.NODE_ENV !== 'production',
});
```

### 5. Implemente Retry Logic

```typescript
async function enviarComRetry(input: SendMessageInput, maxTentativas = 3) {
  const service = getTwilioService();

  for (let i = 0; i < maxTentativas; i++) {
    const result = await service.sendMessage(input);

    if (result.success) {
      return result;
    }

    // Aguardar antes de tentar novamente
    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
  }

  throw new Error('Falha após múltiplas tentativas');
}
```

## 📊 Status da Mensagem

| Status        | Descrição                        |
| ------------- | -------------------------------- |
| `accepted`    | Mensagem aceita pela API         |
| `queued`      | Mensagem enfileirada para envio  |
| `sending`     | Mensagem sendo enviada           |
| `sent`        | Mensagem enviada ao destinatário |
| `delivered`   | Mensagem entregue (confirmado)   |
| `undelivered` | Não foi possível entregar        |
| `failed`      | Falha no envio                   |
| `canceled`    | Mensagem cancelada               |

## 🔗 Links Úteis

- [Twilio Console](https://console.twilio.com)
- [Twilio Docs - WhatsApp](https://www.twilio.com/docs/whatsapp)
- [Twilio Docs - SMS](https://www.twilio.com/docs/sms)
- [Twilio Error Codes](https://www.twilio.com/docs/api/errors)
- [Twilio Pricing](https://www.twilio.com/pricing)

## 📝 Changelog

### v1.0.0 - 2025-01-02

- ✨ Implementação inicial do módulo
- ✅ Suporte a WhatsApp e SMS
- ✅ Dois métodos de autenticação (Auth Token e API Key)
- ✅ Formatação automática de números brasileiros
- ✅ Validação com Zod
- ✅ Gestão de credenciais criptografadas
- ✅ Funções auxiliares para formatação
- ✅ Tratamento de erros robusto
- ✅ Testes unitários completos
- ✅ Documentação completa

## 🤝 Contribuindo

Para contribuir com melhorias:

1. Siga os princípios de Clean Code
2. Adicione testes para novas funcionalidades
3. Atualize a documentação
4. Garanta que todos os testes passem: `pnpm test`

## 📄 Licença

Este módulo faz parte do projeto Alusa e segue a mesma licença.

---

**Desenvolvido com ❤️ pela equipe Alusa**

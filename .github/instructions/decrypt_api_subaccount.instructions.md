---
applyTo: '**'
---

## Como obter a API Key de uma subconta Asaas e executar chamadas

### Passo 1: Consultar o banco de dados

Use o MCP `mcp_alusadb_alusadb` para listar as subcontas:

```
Pergunta: "Liste todos os registros da tabela AsaasAccount com os campos id, financeProfileId, asaasAccountId, apiKeyEncrypted, apiKeyStatus"
```

Isso retornará os registros com o campo `apiKeyEncrypted` no formato:
```
iv:salt:authTag:encryptedData
```

### Passo 2: Obter a ENCRYPTION_KEY

A chave de criptografia está no arquivo `.env.local` na raiz do projeto:
```
ENCRYPTION_KEY=<valor-local-da-env>
```

### Passo 3: Descriptografar a API Key

Criar um script temporário para descriptografar:

```javascript
// scripts/decrypt-asaas-key.mjs
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('Missing required encryption configuration.');
}
const encoded = '<valor de apiKeyEncrypted do banco>';

const raw = ENCRYPTION_KEY;
const key = /^[0-9a-f]{64}$/i.test(raw) 
  ? Buffer.from(raw, 'hex') 
  : Buffer.from(raw, 'base64');

const parts = encoded.split(':');
const [ivHex, , authTagHex, encryptedHex] = parts;

const iv = Buffer.from(ivHex, 'hex');
const authTag = Buffer.from(authTagHex, 'hex');

const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(authTag);
let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
decrypted += decipher.final('utf8');
console.log(decrypted);
```

Executar:
```bash
node scripts/decrypt-asaas-key.mjs
```

**⚠️ IMPORTANTE: Deletar o script após uso para não expor credenciais.**

### Passo 4: Executar chamadas na API do Asaas

Com a API key descriptografada, usar o MCP `mcp_asaas_execute-request`:

```json
{
  "harRequest": {
    "headers": [
      {"name": "access_token", "value": "<API_KEY_DESCRIPTOGRAFADA>"},
      {"name": "Content-Type", "value": "application/json"}
    ],
    "method": "get",
    "url": "https://api-sandbox.asaas.com/v3/payments?limit=10"
  },
  "title": "Asaas"
}
```

### Endpoints úteis

| Endpoint | Descrição |
|----------|-----------|
| `GET /v3/payments` | Listar cobranças |
| `GET /v3/payments/{id}` | Detalhes de uma cobrança |
| `GET /v3/customers` | Listar clientes |
| `GET /v3/subscriptions` | Listar assinaturas |
| `GET /v3/myAccount/status` | Status da conta |

### Ambiente

- **Sandbox**: `https://api-sandbox.asaas.com/v3`
- **Produção**: `https://api.asaas.com/v3`

### Formato da API Key

As API keys do Asaas seguem o padrão:
```
$aact_hmlg_<base64>  → Sandbox (homologação)
$aact_prod_<base64>  → Produção
```

### Segurança

- Nunca commitar scripts com chaves descriptografadas
- Sempre usar variáveis de ambiente em produção
- As chaves são armazenadas criptografadas com AES-256-GCM
- O formato no banco é: `iv:salt:authTag:encryptedData`

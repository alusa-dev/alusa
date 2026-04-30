# @alusa/shared

Utilitários compartilhados, validadores, formatadores e tipos comuns.

## Responsabilidades

- ✅ Validadores (CPF, CNPJ, email, telefone)
- ✅ Formatadores (moeda, data, telefone)
- ✅ Tipos comuns (Result, Maybe, Nullable)
- ✅ Constantes de domínio (billing types, status)
- ✅ Schemas Zod reutilizáveis

## Princípios

- **Zero dependências externas** (exceto Zod)
- **Funções puras** sem efeitos colaterais
- **Tipagem forte** em todas as funções
- **Testável** com 100% de cobertura

## Uso

```typescript
import { isValidCpf, formatCurrency, ok, err } from '@alusa/shared';

// Validação
if (isValidCpf('123.456.789-00')) {
  // ...
}

// Formatação
const formatted = formatCurrency(12345.67); // "R$ 12.345,67"

// Result pattern
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) return err('Division by zero');
  return ok(a / b);
}
```

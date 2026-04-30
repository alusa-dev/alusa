# @alusa/domain

Regras de negócio puras sem dependências de infraestrutura.

## Responsabilidades

- ✅ Regras de negócio (idade mínima, valores, descontos)
- ✅ Value Objects (CPF, Email, Money)
- ✅ Entidades de domínio (quando aplicável)
- ✅ Lógica de validação de negócio

## Princípios

- **Zero dependências de infraestrutura** (sem Prisma, sem Asaas, sem HTTP)
- **Funções puras** sem efeitos colaterais
- **Testável** com 100% de cobertura
- **Independente** de frameworks

## Uso

```typescript
import { precisaResponsavelFinanceiro, valorMinimoMensalidade } from '@alusa/domain';

// Verificar se aluno precisa de responsável
if (precisaResponsavelFinanceiro(idade)) {
  // exigir dados do responsável
}

// Validar valor de mensalidade
if (valor < valorMinimoMensalidade()) {
  throw new Error('Valor abaixo do mínimo permitido');
}
```

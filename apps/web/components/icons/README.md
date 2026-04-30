# Ícones centralizados

Todos os ícones devem ser importados a partir de `@/components/icons/icons`.

```tsx
import { Dashboard, Bell, Search } from '@/components/icons/icons';
// ou dinamicamente
import { Icon } from '@/components/icons/Icon';

<Icon name="Dashboard" size={20} className="text-gray-600" />
```

## Convenção
- Usamos Heroicons (outline) por padrão.
- Nomes exportados sem o sufixo `Icon` para reduzir ruído.
- Se precisar de versão sólida: importar localmente e justificar por comentário.
- Antes de adicionar um novo ícone: verificar se já existe um semanticamente equivalente.

## Adicionando novo ícone
1. Abrir `icons.tsx`.
2. Incluir o ícone no bloco `export { ... }` seguindo o padrão: `NomeOriginalIcon as NomeCurto`.
3. Se for algo específico de um domínio (ex: Financeiro), manter nome claro (`Invoice`, `CashFlow`, etc.).

## Por que centralizar?
- Permite trocar a biblioteca de ícones futuramente alterando apenas um arquivo.
- Evita múltiplos bundles duplicados de ícones.
- Facilita padronizar tamanho / estilo caso criemos um wrapper.

## Componente `<Icon />`
Uso sugerido quando quiser deixar o nome dinâmico ou padronizar tamanho.

Props:
- `name`: chave exportada em `icons.tsx`.
- `size`: largura/altura (default 16).
- Demais props de `SVG` são repassadas.

## Futuro (opcional)
Implementar lazy loading / code-splitting condicional por nome e wrapper para variantes solid temáticas.

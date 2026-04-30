import { describe, expect, it } from 'vitest';
import { replaceMentionSpans } from '@/app/api/contratos/route';

describe('replaceMentionSpans', () => {
  it('converte spans de mention em placeholders brutos', () => {
    const html =
      '<p>Olá <span data-type="mention" data-id="{{aluno.nome}}" data-label="Nome">@Nome</span>!</p>';
    expect(replaceMentionSpans(html)).toBe('<p>Olá {{aluno.nome}}!</p>');
  });

  it('mantém conteúdo sem mentions intacto', () => {
    const html = '<p>Sem variáveis aqui.</p>';
    expect(replaceMentionSpans(html)).toBe(html);
  });
});

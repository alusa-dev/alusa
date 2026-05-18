import { describe, expect, it } from 'vitest';

import {
  avatarVersionFromFoto,
  resolveAlunoPublicAvatar,
  resolvePublicAvatarUrl,
} from '@/lib/media/avatar-url';

describe('avatar-url', () => {
  it('resolve base64 legado via endpoint de mídia', () => {
    const foto = 'data:image/png;base64,iVBORw0KGgo=';
    const url = resolvePublicAvatarUrl({
      entity: 'aluno',
      id: 'aluno-1',
      foto,
    });

    expect(url).toMatch(/^\/api\/media\/avatar\/aluno\/aluno-1\?v=/);
  });

  it('mantém URLs internas de storage', () => {
    const foto = '/api/files/uploads/alunos/conta/aluno-1/avatar.jpg';
    expect(
      resolvePublicAvatarUrl({
        entity: 'aluno',
        id: 'aluno-1',
        foto,
      }),
    ).toBe(foto);
  });

  it('retorna null quando não há foto', () => {
    expect(resolveAlunoPublicAvatar({ id: 'aluno-1', foto: null })).toBeNull();
  });

  it('gera versão estável para cache busting', () => {
    const foto = 'data:image/png;base64,abc';
    const first = avatarVersionFromFoto(foto, '2026-01-01T00:00:00.000Z');
    const second = avatarVersionFromFoto(foto, '2026-01-01T00:00:00.000Z');
    const changed = avatarVersionFromFoto(`${foto}x`, '2026-01-01T00:00:00.000Z');

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });
});

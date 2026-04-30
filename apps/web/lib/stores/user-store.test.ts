import { beforeEach, describe, expect, it } from 'vitest';
import { useUserStore, type User } from './user-store';

describe('useUserStore', () => {
  beforeEach(() => {
    // resetar estado entre testes
    useUserStore.setState({ user: null }, true);
  });

  it('deve setar o usuário', () => {
    useUserStore
      .getState()
      .setUser({ id: 'u1', name: 'Test User', email: 't@x.com' } as unknown as User);
    expect(useUserStore.getState().user?.name).toBe('Test User');
  });

  it('deve atualizar parcialmente o usuário', () => {
    useUserStore.getState().setUser({ id: 'u1', name: 'Old', email: 't@x.com' } as unknown as User);
    useUserStore.getState().updateUser({ name: 'New' });
    expect(useUserStore.getState().user?.name).toBe('New');
  });
});

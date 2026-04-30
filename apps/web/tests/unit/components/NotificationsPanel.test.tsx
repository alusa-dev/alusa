import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationsPanel from '@/components/notifications/NotificationsPanel';

const items = [
  { id: '1', title: 'Nova matrícula', description: 'Aluno João inscrito', createdAt: '2025-09-18T12:00:00Z' },
  { id: '2', title: 'Pagamento recebido', description: 'Mensalidade Setembro', read: true }
];

describe('NotificationsPanel', () => {
  it('não renderiza quando open=false', () => {
    const { container } = render(<NotificationsPanel open={false} onClose={() => {}} items={items} />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza itens quando aberto', () => {
    render(<NotificationsPanel open onClose={() => {}} items={items} />);
    expect(screen.getByRole('dialog', { name: /notificações/i })).toBeInTheDocument();
    expect(screen.getByText(/Nova matrícula/)).toBeInTheDocument();
    expect(screen.getByText(/Pagamento recebido/)).toBeInTheDocument();
  });

  it('chama onClose ao clicar fora', () => {
    const onClose = vi.fn();
    render(<NotificationsPanel open onClose={onClose} items={items} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('chama onClose ao pressionar ESC', () => {
    const onClose = vi.fn();
    render(<NotificationsPanel open onClose={onClose} items={items} />);
    const evt = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(evt);
    expect(onClose).toHaveBeenCalled();
  });
});

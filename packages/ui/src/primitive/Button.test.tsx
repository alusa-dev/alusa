import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Hi</Button>);
  // Usa matcher nativo para evitar depender de jest-dom se setup falhar
  expect(screen.getByText('Hi')).not.toBeNull();
  });
});

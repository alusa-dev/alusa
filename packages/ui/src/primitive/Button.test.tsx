import { render, screen } from '@testing-library/react';
import { Button, buttonVariants } from './Button';
import { describe, it, expect } from 'vitest';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Hi</Button>);
    expect(screen.getByRole('button', { name: 'Hi' })).not.toBeNull();
  });

  it('keeps wizard variants in the shared public API', () => {
    render(<Button variant="wizardPrimary">Continuar</Button>);

    expect(screen.getByRole('button', { name: 'Continuar' }).className).toContain(
      'alusa-button--wizard-primary',
    );
    expect(buttonVariants({ variant: 'wizardSecondary' })).toContain(
      'alusa-button--wizard-secondary',
    );
  });

  it('supports rendering a child element with asChild', () => {
    render(
      <Button asChild variant="outline">
        <a href="/students">Students</a>
      </Button>,
    );

    expect(screen.getByRole('link', { name: 'Students' }).className).toContain(
      'alusa-button--outline',
    );
  });
});

import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateCroppedImageMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/image', () => ({
  generateCroppedImage: generateCroppedImageMock,
}));

vi.mock('@/components/image/ImageCropper', () => ({
  ImageCropper: ({ onCropComplete }: { onCropComplete: (_area: { x: number; y: number; width: number; height: number }) => void }) => {
    React.useEffect(() => {
      onCropComplete({ x: 0, y: 0, width: 800, height: 800 });
    }, [onCropComplete]);
    return <div data-testid="cropper" />;
  },
}));

import { ImageCropDialog } from '@/components/image/ImageCropDialog';

const cropResult = {
  blob: new Blob([Uint8Array.from([1])], { type: 'image/jpeg' }),
  dataUrl: 'data:image/jpeg;base64,AQ==',
  width: 512,
  height: 512,
  wasUpscaled: false,
};

describe('ImageCropDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateCroppedImageMock.mockResolvedValue(cropResult);
  });

  it('expõe o título do Radix como nome acessível do diálogo', async () => {
    render(
      <ImageCropDialog
        open
        onOpenChange={vi.fn()}
        src="blob:avatar"
        title="Ajustar foto de perfil"
        onApply={vi.fn()}
      />,
    );

    expect(await screen.findByRole('dialog', { name: 'Ajustar foto de perfil' })).toBeInTheDocument();
  });

  it('aguarda o salvamento assíncrono antes de solicitar o fechamento', async () => {
    let finishSaving: (() => void) | undefined;
    const onApply = vi.fn(() => new Promise<void>((resolve) => {
      finishSaving = resolve;
    }));
    const onOpenChange = vi.fn();
    render(
      <ImageCropDialog
        open
        onOpenChange={onOpenChange}
        src="blob:avatar"
        applyLabel="Salvar foto"
        applyingLabel="Salvando foto..."
        onApply={onApply}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Salvar foto' }));
    expect(await screen.findByRole('button', { name: 'Salvando foto...' })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    finishSaving?.();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('mantém o editor aberto e apresenta erro quando o salvamento falha', async () => {
    const onOpenChange = vi.fn();
    render(
      <ImageCropDialog
        open
        onOpenChange={onOpenChange}
        src="blob:avatar"
        applyLabel="Salvar foto"
        onApply={vi.fn().mockRejectedValue(new Error('Falha temporária no upload.'))}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Salvar foto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha temporária no upload.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

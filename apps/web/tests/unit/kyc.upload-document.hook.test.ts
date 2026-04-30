import { describe, it, expect, vi, beforeEach } from 'vitest';

import { uploadDocument } from '@/features/kyc/hooks/use-kyc-upload';

describe('uploadDocument', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('não chama fetch quando groupId é vazio', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const file = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });

    await expect(uploadDocument('', file, 'IDENTIFICATION')).rejects.toThrow('Grupo de documento inválido');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('não chama fetch quando groupId contém espaços', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const file = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });

    await expect(
      uploadDocument('grp 1', file, 'IDENTIFICATION'),
    ).rejects.toThrow('Grupo de documento inválido');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('não chama fetch quando groupId contém "/"', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const file = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });

    await expect(uploadDocument('grp/1', file, 'IDENTIFICATION')).rejects.toThrow('Grupo de documento inválido');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

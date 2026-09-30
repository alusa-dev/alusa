import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_INLINE_UPLOAD_MAX_BYTES, putFileWithXhr, shouldUploadContractDirectly } from '@/features/contracts/services/contract-templates-service';

describe('contract upload transport', () => {
  it('keeps small files inline and routes larger files through direct storage', () => {
    expect(shouldUploadContractDirectly(CONTRACT_INLINE_UPLOAD_MAX_BYTES)).toBe(false);
    expect(shouldUploadContractDirectly(CONTRACT_INLINE_UPLOAD_MAX_BYTES + 1)).toBe(true);
  });

  it('sends signed headers with XHR and lets the browser derive Content-Length from the File', async () => {
    const xhr = {
      upload: {} as XMLHttpRequestUpload,
      status: 200,
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(function (this: { onload?: () => void }) { this.onload?.(); }),
      onload: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined,
    };
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => xhr));
    const file = new File(['pdf'], 'contract.pdf', { type: 'application/pdf' });

    await putFileWithXhr('https://storage.example/upload', file, {
      'Content-Type': 'application/pdf',
      'Content-Length': '3',
      'x-amz-meta-upload-reservation-id': 'reservation',
    });

    expect(xhr.open).toHaveBeenCalledWith('PUT', 'https://storage.example/upload');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('x-amz-meta-upload-reservation-id', 'reservation');
    expect(xhr.setRequestHeader).not.toHaveBeenCalledWith('Content-Length', '3');
    expect(xhr.send).toHaveBeenCalledWith(file);
  });
});

afterEach(() => vi.unstubAllGlobals());

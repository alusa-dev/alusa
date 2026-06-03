import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { generateSignedContractEvidencePdf } from './generate-signed-contract-pdf';

async function createOriginalPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText('Contrato de teste', {
    x: 48,
    y: 760,
    size: 18,
    font,
    color: rgb(0.06, 0.09, 0.16),
  });

  return Buffer.from(await pdf.save());
}

describe('generateSignedContractEvidencePdf', () => {
  it('preserves the original PDF and appends a signature certificate page', async () => {
    const originalPdfBytes = await createOriginalPdf();

    const signedPdf = await generateSignedContractEvidencePdf({
      contratoId: 'contrato-1',
      matriculaId: 'matricula-1',
      contaNome: 'Escola Alusa',
      alunoNome: 'Bryan de Alencar Bezerra',
      signerName: 'Bryan de Alencar Bezerra',
      signerCpf: '04410435264',
      email: 'blend.studioo@gmail.com',
      signedAtIso: '2026-06-02T04:36:49.000Z',
      ip: '127.0.0.1',
      userAgent: 'Vitest',
      originalPdfHash: 'a'.repeat(64),
      presentedPdfHash: 'b'.repeat(64),
      signatureHash: 'c'.repeat(64),
      originalPdfBytes,
    });

    const originalPdf = await PDFDocument.load(originalPdfBytes);
    const outputPdf = await PDFDocument.load(signedPdf.bytes);

    expect(outputPdf.getPageCount()).toBe(originalPdf.getPageCount() + 1);
    expect(signedPdf.hashSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(signedPdf.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(signedPdf.tamanhoBytes).toBeGreaterThan(originalPdfBytes.byteLength);
  });
});

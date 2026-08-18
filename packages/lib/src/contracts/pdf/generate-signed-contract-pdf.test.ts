import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  calculateSignaturePlacement,
  generateSignedContractEvidencePdf,
} from './generate-signed-contract-pdf';

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
  it('mapeia o canvas completo para a linha e usa seu centro como âncora', () => {
    const placement = calculateSignaturePlacement({
      pageWidth: 600,
      pageHeight: 800,
      field: { x: 0.25, y: 0.7, largura: 0.4, altura: 0.03 },
      imageWidth: 480,
      imageHeight: 120,
    });

    expect(placement.x).toBe(150);
    expect(placement.width).toBe(240);
    expect(placement.height).toBe(60);
    expect(placement.baselineY).toBeCloseTo(216);
    expect(placement.y + placement.height / 2).toBeCloseTo(placement.baselineY);
  });

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
      assinatura: { tipo: 'TEXTO', valor: 'Bryan de Alencar Bezerra' },
      camposAssinatura: [
        {
          tipo: 'ASSINATURA',
          papel: 'RESPONSAVEL_OU_ALUNO',
          pagina: 1,
          x: 0.2,
          y: 0.8,
          largura: 0.5,
          altura: 0.08,
        },
      ],
    });

    const originalPdf = await PDFDocument.load(originalPdfBytes);
    const outputPdf = await PDFDocument.load(signedPdf.bytes);

    expect(outputPdf.getPageCount()).toBe(originalPdf.getPageCount() + 1);
    expect(signedPdf.hashSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(signedPdf.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(signedPdf.tamanhoBytes).toBeGreaterThan(originalPdfBytes.byteLength);
  });

  it('aplica assinatura desenhada no campo do responsável sem alterar a quantidade de páginas originais', async () => {
    const originalPdfBytes = await createOriginalPdf();
    const signedPdf = await generateSignedContractEvidencePdf({
      contratoId: 'contrato-2',
      matriculaId: 'matricula-2',
      contaNome: 'Escola Alusa',
      alunoNome: 'Aluno de teste',
      signerName: 'Responsável de teste',
      signerCpf: '04410435264',
      signedAtIso: '2026-06-02T04:36:49.000Z',
      originalPdfHash: 'a'.repeat(64),
      presentedPdfHash: 'b'.repeat(64),
      signatureHash: 'c'.repeat(64),
      originalPdfBytes,
      assinatura: {
        tipo: 'DESENHADA',
        valor: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
      camposAssinatura: [
        {
          tipo: 'ASSINATURA',
          papel: 'RESPONSAVEL_OU_ALUNO',
          pagina: 1,
          x: 0.2,
          y: 0.8,
          largura: 0.5,
          altura: 0.08,
        },
      ],
    });

    const outputPdf = await PDFDocument.load(signedPdf.bytes);
    expect(outputPdf.getPageCount()).toBe(2);
    expect(signedPdf.hashSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('anexa as decisões de consentimento em uma página de evidências separada', async () => {
    const originalPdfBytes = await createOriginalPdf();
    const signedPdf = await generateSignedContractEvidencePdf({
      contratoId: 'contrato-consentimento',
      matriculaId: 'matricula-consentimento',
      contaNome: 'Escola Alusa',
      alunoNome: 'Aluno de teste',
      signerName: 'Responsável de teste',
      signerCpf: '04410435264',
      signedAtIso: '2026-06-02T04:36:49.000Z',
      originalPdfHash: 'a'.repeat(64),
      presentedPdfHash: 'b'.repeat(64),
      signatureHash: 'c'.repeat(64),
      originalPdfBytes,
      assinatura: { tipo: 'TEXTO', valor: 'Responsável de teste' },
      camposAssinatura: [],
      consentimentos: [{
        titulo: 'Uso de imagem',
        finalidade: 'IMAGE_USE',
        texto: 'Autorizo o uso da imagem do aluno em materiais institucionais.',
        decision: 'RECUSADO',
      }],
    });

    const outputPdf = await PDFDocument.load(signedPdf.bytes);
    expect(outputPdf.getPageCount()).toBe(3);
  });
});

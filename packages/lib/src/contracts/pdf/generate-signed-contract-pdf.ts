import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  CONTRACT_ACCEPTANCE_TEXT_V1,
  CONTRACT_ACCEPTANCE_VERSION,
  maskCpf,
  sha256Hex,
} from '@alusa/domain';

type SignedContractPdfInput = {
  contratoId: string;
  matriculaId: string;
  contaNome: string;
  alunoNome: string;
  signerName: string;
  signerCpf: string;
  email?: string | null;
  signedAtIso: string;
  ip?: string | null;
  userAgent?: string | null;
  originalPdfHash: string;
  presentedPdfHash: string;
  signatureHash: string;
  originalPdfBytes: Uint8Array | Buffer;
};

function splitText(value: string, maxLength: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function drawWrappedText(params: {
  page: import('pdf-lib').PDFPage;
  text: string;
  x: number;
  y: number;
  maxLength: number;
  lineHeight: number;
  size: number;
  font: import('pdf-lib').PDFFont;
  color?: ReturnType<typeof rgb>;
}) {
  let y = params.y;
  const lines = splitText(params.text, params.maxLength);

  for (const line of lines) {
    params.page.drawText(line, {
      x: params.x,
      y,
      size: params.size,
      font: params.font,
      color: params.color ?? rgb(0.11, 0.15, 0.22),
    });
    y -= params.lineHeight;
  }

  return y;
}

export async function generateSignedContractEvidencePdf(input: SignedContractPdfInput): Promise<{
  bytes: Buffer;
  hashSha256: string;
  dataUrl: string;
  tamanhoBytes: number;
}> {
  const pdf = await PDFDocument.load(input.originalPdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 48;
  let y = height - margin;

  page.drawText('Certificado de assinatura eletronica', {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });
  y -= 28;

  page.drawText('Documento assinado eletronicamente pela plataforma Alusa.', {
    x: margin,
    y,
    size: 10,
    font: regular,
    color: rgb(0.39, 0.45, 0.55),
  });
  y -= 26;

  const rows = [
    ['Contrato', input.contratoId],
    ['Matricula', input.matriculaId],
    ['Escola/conta', input.contaNome],
    ['Aluno', input.alunoNome],
    ['Assinante', input.signerName],
    ['CPF', maskCpf(input.signerCpf)],
    ['Email informado', input.email || 'nao informado'],
    ['Data/hora da assinatura', new Date(input.signedAtIso).toLocaleString('pt-BR')],
    ['IP', input.ip || 'nao informado'],
  ];

  for (const [label, value] of rows) {
    page.drawText(`${label}:`, {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: rgb(0.11, 0.15, 0.22),
    });
    y = drawWrappedText({
      page,
      text: value,
      x: margin + 150,
      y,
      maxLength: 72,
      lineHeight: 14,
      size: 10,
      font: regular,
    });
    y -= 5;
  }

  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.8,
    color: rgb(0.86, 0.9, 0.95),
  });
  y -= 22;

  const hashRows = [
    ['Hash do PDF original', input.originalPdfHash],
    ['Hash do PDF apresentado', input.presentedPdfHash],
    ['Hash da assinatura', input.signatureHash],
  ];

  for (const [label, value] of hashRows) {
    page.drawText(`${label}:`, {
      x: margin,
      y,
      size: 9,
      font: bold,
      color: rgb(0.11, 0.15, 0.22),
    });
    y = drawWrappedText({
      page,
      text: value,
      x: margin,
      y: y - 14,
      maxLength: 86,
      lineHeight: 12,
      size: 8,
      font: mono,
      color: rgb(0.21, 0.45, 0.37),
    });
    y -= 10;
  }

  page.drawText('Texto do aceite:', {
    x: margin,
    y,
    size: 9,
    font: bold,
    color: rgb(0.11, 0.15, 0.22),
  });
  y = drawWrappedText({
    page,
    text: `v${CONTRACT_ACCEPTANCE_VERSION}: ${CONTRACT_ACCEPTANCE_TEXT_V1}`,
    x: margin,
    y: y - 14,
    maxLength: 92,
    lineHeight: 12,
    size: 8,
    font: regular,
    color: rgb(0.39, 0.45, 0.55),
  });
  y -= 12;

  page.drawText('Dispositivo / user agent:', {
    x: margin,
    y,
    size: 9,
    font: bold,
    color: rgb(0.11, 0.15, 0.22),
  });
  drawWrappedText({
    page,
    text: input.userAgent || 'nao informado',
    x: margin,
    y: y - 14,
    maxLength: 92,
    lineHeight: 11,
    size: 7,
    font: regular,
    color: rgb(0.39, 0.45, 0.55),
  });

  page.drawText('A pagina acima foi adicionada ao PDF original no momento da assinatura.', {
    x: margin,
    y: 42,
    size: 8,
    font: regular,
    color: rgb(0.39, 0.45, 0.55),
  });

  const saved = await pdf.save({
    addDefaultPage: false,
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
  const bytes = Buffer.from(saved);
  const hashSha256 = sha256Hex(bytes);

  return {
    bytes,
    hashSha256,
    dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`,
    tamanhoBytes: bytes.byteLength,
  };
}

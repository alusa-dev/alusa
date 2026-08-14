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
  contextLabel?: string;
  contextId?: string;
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
  assinatura: { tipo: 'TEXTO' | 'DESENHADA'; valor: string; fonte?: string };
  camposAssinatura: Array<{
    tipo: 'ASSINATURA' | 'RUBRICA';
    papel: 'ESCOLA' | 'RESPONSAVEL_OU_ALUNO';
    pagina: number;
    x: number;
    y: number;
    largura: number;
    altura: number;
  }>;
};

function decodeSignatureImage(value: string) {
  const match = value.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return null;
  return { type: match[1].toLowerCase() === 'png' ? 'png' as const : 'jpg' as const, bytes: Buffer.from(match[2], 'base64') };
}

export function calculateSignaturePlacement(input: {
  pageWidth: number;
  pageHeight: number;
  field: Pick<SignedContractPdfInput['camposAssinatura'][number], 'x' | 'y' | 'largura' | 'altura'>;
  imageWidth: number;
  imageHeight: number;
}) {
  const x = input.field.x * input.pageWidth;
  const width = input.field.largura * input.pageWidth;
  const baselineY = input.pageHeight - ((input.field.y + input.field.altura) * input.pageHeight);
  // The image is the complete transparent drawing canvas, not a crop around
  // the ink. Mapping its full width to the configured line preserves every
  // horizontal margin and makes the signed PDF match the signing preview.
  const scale = width / input.imageWidth;
  const height = input.imageHeight * scale;

  return {
    x,
    y: baselineY - height / 2,
    width,
    height,
    baselineY,
  };
}

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
  const signatureFontName = input.assinatura.fonte?.toLowerCase() ?? '';
  const signatureFont = await pdf.embedFont(
    signatureFontName.includes('courier') || signatureFontName.includes('mono')
      ? StandardFonts.CourierOblique
      : signatureFontName.includes('arial') || signatureFontName.includes('sans')
        ? StandardFonts.HelveticaOblique
        : StandardFonts.TimesRomanItalic,
  );

  const signerFields = input.camposAssinatura;
  const signatureImage = input.assinatura.tipo === 'DESENHADA'
    ? decodeSignatureImage(input.assinatura.valor)
    : null;
  const embeddedSignature = signatureImage
    ? signatureImage.type === 'png'
      ? await pdf.embedPng(signatureImage.bytes)
      : await pdf.embedJpg(signatureImage.bytes)
    : null;

  for (const campo of signerFields) {
    const targetPage = pdf.getPages()[campo.pagina - 1];
    if (!targetPage) continue;
    const pageSize = targetPage.getSize();
    const x = campo.x * pageSize.width;
    const width = campo.largura * pageSize.width;
    // A signature field is a baseline anchor. Its height is only the clickable
    // area; it must never constrain the natural height of the signature.
    const baselineY = pageSize.height - ((campo.y + campo.altura) * pageSize.height);

    const isSchoolField = campo.papel === 'ESCOLA';
    if (embeddedSignature && !isSchoolField) {
      const imageSize = embeddedSignature.scale(1);
      const placement = calculateSignaturePlacement({
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        field: campo,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
      });
      targetPage.drawImage(embeddedSignature, {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      });
    } else {
      const text = isSchoolField ? input.contaNome : input.assinatura.valor;
      const fontSize = Math.max(10, Math.min(18, width / Math.max(text.length * 0.5, 1)));
      targetPage.drawText(text, {
        x,
        // In pdf-lib, `y` is the text baseline. Using the configured field
        // line directly keeps the automatic school signature resting on the
        // line instead of crossing through it.
        y: baselineY + 1,
        size: fontSize,
        font: signatureFont,
        color: rgb(0.08, 0.1, 0.18),
        maxWidth: Math.max(10, width),
      });
    }
  }

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
    [input.contextLabel ?? 'Matricula', input.contextId ?? input.matriculaId],
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

import { pdfjs } from 'react-pdf';

/**
 * Worker do PDF.js servido pelo próprio app (compatível com CSP script-src/worker-src 'self').
 * Evita dependência de cdnjs.cloudflare.com bloqueada pelos security headers.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

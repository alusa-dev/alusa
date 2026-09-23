import { resolveEventMapLayout } from '../layout/resolve-map-layout.js';
import type { EventMapDocument, LayoutDiagnostic } from '../model/event-map-document.js';

export type MapDocumentValidation = {
  valid: boolean;
  diagnostics: LayoutDiagnostic[];
};

export const BLOCKING_MAP_DOCUMENT_DIAGNOSTIC_TYPES = [
  'INVALID_SECTION',
  'INVALID_ROW_PATH',
  'INVALID_DISTRIBUTION',
  'INVALID_SPACING',
  'ROW_OUTSIDE_SECTION',
  'SEAT_OUTSIDE_SECTION',
  'SEAT_OVERLAP',
] as const;

export function validateEventMapDocument(document: EventMapDocument): MapDocumentValidation {
  const layout = resolveEventMapLayout(document);
  return {
    valid: layout.diagnostics.every((diagnostic) => !BLOCKING_MAP_DOCUMENT_DIAGNOSTIC_TYPES.includes(diagnostic.type)),
    diagnostics: layout.diagnostics,
  };
}

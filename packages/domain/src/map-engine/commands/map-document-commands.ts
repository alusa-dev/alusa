import type { EventMapDocument, MapPoint } from '../model/event-map-document.js';

export type MapDocumentCommand =
  | { type: 'REPLACE_DOCUMENT'; before: EventMapDocument; after: EventMapDocument; description: string }
  | { type: 'MOVE_SECTION'; sectionId: string; from: MapPoint; to: MapPoint; description?: string };

export function applyMapDocumentCommand(document: EventMapDocument, command: MapDocumentCommand): EventMapDocument {
  if (command.type === 'REPLACE_DOCUMENT') return command.after;
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.id === command.sectionId ? { ...section, position: { ...command.to } } : section,
    ),
  };
}
export function revertMapDocumentCommand(document: EventMapDocument, command: MapDocumentCommand): EventMapDocument {
  if (command.type === 'REPLACE_DOCUMENT') return command.before;
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.id === command.sectionId ? { ...section, position: { ...command.from } } : section,
    ),
  };
}

export class MapDocumentHistory {
  private readonly undoStack: MapDocumentCommand[] = [];
  private readonly redoStack: MapDocumentCommand[] = [];

  execute(document: EventMapDocument, command: MapDocumentCommand) {
    this.undoStack.push(command);
    this.redoStack.length = 0;
    return applyMapDocumentCommand(document, command);
  }

  undo(document: EventMapDocument) {
    const command = this.undoStack.pop();
    if (!command) return document;
    this.redoStack.push(command);
    return revertMapDocumentCommand(document, command);
  }

  redo(document: EventMapDocument) {
    const command = this.redoStack.pop();
    if (!command) return document;
    this.undoStack.push(command);
    return applyMapDocumentCommand(document, command);
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get sizes() {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}

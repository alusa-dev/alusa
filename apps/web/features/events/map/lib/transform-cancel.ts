import Konva from 'konva';

export type TransformNodeSnapshot = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  bodyWidth?: number;
  bodyHeight?: number;
};

export function captureTransformNodeSnapshots(stage: Konva.Stage, nodeIds: string[]): TransformNodeSnapshot[] {
  const snapshots: TransformNodeSnapshot[] = [];

  for (const nodeId of nodeIds) {
    const node = stage.findOne(`#${nodeId}`);
    if (!node) continue;

    const container = node as Konva.Container;
    const body = container.findOne('.corridor-body') as Konva.Rect | undefined;
    snapshots.push({
      id: nodeId,
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      bodyWidth: body?.width(),
      bodyHeight: body?.height(),
    });
  }

  return snapshots;
}

export function restoreTransformNodeSnapshots(stage: Konva.Stage, snapshots: TransformNodeSnapshot[]) {
  for (const snapshot of snapshots) {
    const node = stage.findOne(`#${snapshot.id}`);
    if (!node) continue;

    node.position({ x: snapshot.x, y: snapshot.y });
    node.rotation(snapshot.rotation);
    node.scaleX(snapshot.scaleX);
    node.scaleY(snapshot.scaleY);

    const container = node as Konva.Container;
    const body = container.findOne('.corridor-body') as Konva.Rect | undefined;
    if (body && typeof snapshot.bodyWidth === 'number' && typeof snapshot.bodyHeight === 'number') {
      body.width(snapshot.bodyWidth);
      body.height(snapshot.bodyHeight);
    }
  }
}

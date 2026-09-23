'use client';

import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Image as KonvaImage, Transformer } from 'react-konva';
import type { MapReferenceChart, MapReferenceTransform } from '@alusa/domain';

import { mapReferenceTransformFromNode } from '../canvas/render/map-reference-transform';

export function ReferenceChartLayer({
  chart,
  editing,
  onTransformCommit,
}: {
  chart: MapReferenceChart | null | undefined;
  editing: boolean;
  onTransformCommit: (_transform: MapReferenceTransform) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageRef = useRef<Konva.Image | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);

  useEffect(() => {
    if (!chart?.url || typeof window === 'undefined') {
      setImage(null);
      return;
    }
    const nextImage = new window.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.onerror = () => setImage(null);
    nextImage.src = chart.url;
    return () => {
      nextImage.onload = null;
      nextImage.onerror = null;
    };
  }, [chart?.url]);

  useEffect(() => {
    const node = imageRef.current;
    const transformer = transformerRef.current;
    if (!editing || !chart?.visible || !node || !transformer) return;
    transformer.nodes([node]);
    transformer.getLayer()?.batchDraw();
  }, [editing, image, chart?.visible]);

  if (!chart?.visible || !image) return null;

  function commitDrag(event: Konva.KonvaEventObject<DragEvent>) {
    event.cancelBubble = true;
    const node = event.target;
    onTransformCommit({ ...chart!.transform, x: node.x(), y: node.y() });
  }

  function commitTransform(event: Konva.KonvaEventObject<Event>) {
    event.cancelBubble = true;
    const node = event.target as Konva.Image;
    const nextTransform = mapReferenceTransformFromNode(chart!.transform, {
      x: node.x(),
      y: node.y(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: node.rotation(),
    });
    node.scaleX(1);
    node.scaleY(1);
    onTransformCommit(nextTransform);
  }

  return (
    <>
      <KonvaImage
        ref={imageRef}
        image={image}
        x={chart.transform.x}
        y={chart.transform.y}
        width={chart.width}
        height={chart.height}
        scaleX={chart.transform.scale}
        scaleY={chart.transform.scale}
        rotation={chart.transform.rotation}
        opacity={chart.opacity}
        listening={editing}
        draggable={editing}
        onMouseDown={(event) => { event.cancelBubble = true; }}
        onDragEnd={commitDrag}
        onTransformEnd={commitTransform}
      />
      {editing ? (
        <Transformer
          ref={transformerRef}
          rotateEnabled
          flipEnabled={false}
          keepRatio
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          borderStroke="#7c3aed"
          anchorStroke="#7c3aed"
          anchorFill="#ffffff"
          anchorSize={8}
        />
      ) : null}
    </>
  );
}

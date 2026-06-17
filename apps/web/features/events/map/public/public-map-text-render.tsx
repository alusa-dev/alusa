import {
  buildPublicMapTextLines,
  clampFontSizeValue,
  getPublicMapTextAnchor,
  getPublicMapTextAnchorX,
  getPublicMapTextStartY,
  getTextDecorationValue,
  getTextMode,
  type EventMapObjectDTO,
} from '@alusa/domain';

export type PublicMapTextObject = Pick<
  EventMapObjectDTO,
  'id' | 'x' | 'y' | 'width' | 'height' | 'rotation'
> & {
  data?: EventMapObjectDTO['data'];
};

export function PublicMapTextSvg({ object }: { object: PublicMapTextObject }) {
  const data = object.data ?? {};
  const textObject = { ...object, data };
  const lines = buildPublicMapTextLines(textObject);
  const fontSize = clampFontSizeValue(Number(data.fontSize ?? 22));
  const lineHeight = Number(data.lineHeight ?? 1.2);
  const align = String(data.align ?? 'left');
  const mode = getTextMode(textObject);
  const anchorX = getPublicMapTextAnchorX(textObject, align);
  const startY = getPublicMapTextStartY(textObject, lines.length, fontSize, lineHeight);
  const strokeWidth = Number(data.strokeWidth ?? 0);
  const stroke = String(data.stroke ?? '#000000');
  const clipId = `public-text-clip-${object.id}`;

  return (
    <g
      transform={`rotate(${object.rotation} ${object.x} ${object.y})`}
      clipPath={mode === 'area' && typeof object.height === 'number' && object.height > 0 ? `url(#${clipId})` : undefined}
    >
      {mode === 'area' && typeof object.width === 'number' && object.width > 0 && typeof object.height === 'number' && object.height > 0 ? (
        <clipPath id={clipId}>
          <rect x={object.x} y={object.y} width={object.width} height={object.height} />
        </clipPath>
      ) : null}
      <text
        x={anchorX}
        y={startY}
        fill={String(data.fill ?? '#0f172a')}
        opacity={Number(data.opacity ?? 1)}
        fontSize={fontSize}
        fontFamily={String(data.fontFamily ?? 'Inter, sans-serif')}
        fontWeight={data.fontWeight === 'bold' ? 'bold' : 'normal'}
        fontStyle={data.italic ? 'italic' : 'normal'}
        textDecoration={getTextDecorationValue(data) ?? undefined}
        textAnchor={getPublicMapTextAnchor(align)}
        dominantBaseline="hanging"
        letterSpacing={Number(data.letterSpacing ?? 0)}
        stroke={strokeWidth > 0 ? stroke : undefined}
        strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
        paintOrder={strokeWidth > 0 ? 'stroke fill' : undefined}
      >
        {lines.map((line, index) => (
          <tspan key={`${object.id}-${index}`} x={anchorX} dy={index === 0 ? 0 : fontSize * lineHeight}>
            {line || ' '}
          </tspan>
        ))}
      </text>
    </g>
  );
}

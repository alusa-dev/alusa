'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  Add01Icon,
  ArrowLeftRightIcon,
  ArrowRight01Icon,
  ArrowUpDownIcon,
  AlignHorizontalCenterIcon,
  Chair01Icon,
  ArrowLeft01Icon,
  BlockedIcon,
  CheckmarkCircle01Icon,
  CircleIcon,
  LockedIcon,
  CopyIcon,
  CopyCheckIcon,
  CursorRectangleSelection01Icon,
  CursorTextIcon,
  Delete01Icon,
  DragDropVerticalIcon,
  EyeIcon,
  EyeOffIcon,
  ExpandIcon,
  GeometricShapes01Icon,
  HandGrabIcon,
  ImageUpload01Icon,
  InformationCircleIcon,
  LayerIcon,
  LayoutTwoRowIcon,
  MinusSignIcon,
  MapsIcon,
  PencilEdit01Icon,
  Remove01Icon,
  ResourcesAddIcon,
  RedoIcon,
  RocketIcon,
  SaveIcon,
  Settings01Icon,
  SquareIcon,
  EllipseIcon,
  TriangleIcon,
  TheaterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
  Ticket01Icon,
  UndoIcon,
  Upload01Icon,
  ZoomInIcon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

const creatorIcons = {
  map: MapsIcon,
  layers: LayerIcon,
  block: LayoutTwoRowIcon,
  seat: Chair01Icon,
  stage: TheaterIcon,
  select: CursorRectangleSelection01Icon,
  pan: HandGrabIcon,
  dragHandle: DragDropVerticalIcon,
  zoom: ZoomInIcon,
  text: CursorTextIcon,
  shape: ResourcesAddIcon,
  square: SquareIcon,
  circle: CircleIcon,
  ellipse: EllipseIcon,
  triangle: TriangleIcon,
  reference: ImageUpload01Icon,
  upload: Upload01Icon,
  edit: PencilEdit01Icon,
  delete: Delete01Icon,
  visible: EyeIcon,
  hidden: EyeOffIcon,
  locked: LockedIcon,
  settings: Settings01Icon,
  save: SaveIcon,
  publish: RocketIcon,
  continue: ArrowRight01Icon,
  undo: UndoIcon,
  redo: RedoIcon,
  back: ArrowLeft01Icon,
  success: CheckmarkCircle01Icon,
  warning: AlertCircleIcon,
  blocked: BlockedIcon,
  geometry: GeometricShapes01Icon,
  add: Add01Icon,
  remove: Remove01Icon,
  maximize: ExpandIcon,
  alignLeft: TextAlignLeftIcon,
  alignCenter: AlignHorizontalCenterIcon,
  alignRight: TextAlignRightIcon,
  bold: TextBoldIcon,
  italic: TextItalicIcon,
  underline: TextUnderlineIcon,
  strikethrough: TextStrikethroughIcon,
  minus: MinusSignIcon,
  horizontal: ArrowLeftRightIcon,
  vertical: ArrowUpDownIcon,
  info: InformationCircleIcon,
  ticket: Ticket01Icon,
  copy: CopyIcon,
  copySuccess: CopyCheckIcon,
} as const;

export type CreatorIconName = keyof typeof creatorIcons;
export type CreatorIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, 'icon'> & {
  name: CreatorIconName;
};

/**
 * Semantic icon boundary for the map creator.
 * Keep Hugeicons imports here so the editor does not couple business UI to
 * vendor icon names and so the creator can migrate independently from the
 * rest of the application.
 */
export function CreatorIcon({ name, ...props }: CreatorIconProps) {
  return <HugeiconsIcon icon={creatorIcons[name]} {...props} />;
}

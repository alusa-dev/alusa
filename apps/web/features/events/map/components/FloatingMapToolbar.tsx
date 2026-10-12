'use client';
import type { MapTool } from '../store/event-map-editor-store';
import { CreatorIcon, type CreatorIconName } from '@/components/icons/hugeicons';

import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react';
import { MAP_TOOLBAR_SURFACE_CLASS } from './map-toolbar-styles';

const toolbarSpring = { type: 'spring' as const, bounce: 0, duration: 0.4 };

type ToolbarTool = {
  id: MapTool;
  label: string;
  shortcut?: string;
  icon: CreatorIconName;
};

const presetTools: ToolbarTool[] = [
  { id: 'seat', label: 'Bloco de fileiras', shortcut: 'C', icon: 'seat' },
  { id: 'stage', label: 'Adicionar palco', icon: 'stage' },
  { id: 'blocked', label: 'Área bloqueada', icon: 'blocked' },
];

const shapeTools: ToolbarTool[] = [
  { id: 'shape-square', label: 'Quadrado', icon: 'square' },
  { id: 'shape-circle', label: 'Círculo', icon: 'circle' },
  { id: 'shape-ellipse', label: 'Elipse', icon: 'ellipse' },
  { id: 'shape-triangle', label: 'Triângulo', icon: 'triangle' },
];

const tools: ToolbarTool[] = [
  { id: 'select', label: 'Selecionar', shortcut: 'V', icon: 'select' },
  { id: 'pan', label: 'Mover canvas', shortcut: 'H', icon: 'pan' },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z', icon: 'zoom' },
  { id: 'text', label: 'Adicionar texto', shortcut: 'T', icon: 'text' },
];

type ToolbarButtonProps = Omit<
  ComponentPropsWithoutRef<typeof motion.button>,
  'aria-label' | 'children' | 'className' | 'onClick'
> & {
  active: boolean;
  ariaLabel?: string;
  icon: CreatorIconName;
  label: string;
  onClick?: ComponentPropsWithoutRef<typeof motion.button>['onClick'];
  className?: string;
};

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    { active, ariaLabel, icon, label, onClick, className, ...buttonProps },
    ref,
  ) {
    return (
      <motion.button
        {...buttonProps}
        ref={ref}
        type="button"
        aria-label={ariaLabel ?? label}
        onClick={onClick}
        initial={false}
        animate={{
          gap: active ? 8 : 0,
          paddingLeft: active ? 8 : 4,
          paddingRight: active ? 8 : 4,
        }}
        transition={toolbarSpring}
        className={cn(
          'flex h-9 w-auto min-w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-transparent text-slate-500 hover:!bg-transparent hover:!text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40',
          active && 'bg-brand-accent text-white shadow-sm hover:!bg-brand-accent hover:!text-white',
          className,
        )}
      >
        <CreatorIcon name={icon} size={16} className="shrink-0" />
        <AnimatePresence initial={false}>
          {active ? (
            <motion.span
              key="toolbar-label"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={toolbarSpring}
              className="max-w-[calc(100vw-17rem)] truncate overflow-hidden whitespace-nowrap text-xs sm:max-w-none"
            >
              {label}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.button>
    );
  },
);

function ToolbarDropdown({
  menuId,
  label,
  triggerIcon,
  items,
  activeTool,
  onToolChange,
  open,
  onOpenChange,
}: {
  menuId: 'elements' | 'shapes';
  label: string;
  triggerIcon: CreatorIconName;
  items: ToolbarTool[];
  activeTool: MapTool;
  onToolChange: (_tool: MapTool) => void;
  open: boolean;
  onOpenChange: (_menuId: 'elements' | 'shapes', _open: boolean) => void;
}) {
  const activeItem = items.find((tool) => tool.id === activeTool);
  const isActive = Boolean(activeItem);

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => onOpenChange(menuId, nextOpen)}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          icon={triggerIcon}
          label={activeItem?.label ?? label}
          active={isActive}
          ariaLabel={label}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-52">
        <div className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">{label}</div>
        {items.map((tool) => {
          return (
            <DropdownMenuItem
              key={tool.id}
              data-testid={`toolbar-${tool.id}-tool`}
              onSelect={() => onToolChange(tool.id)}
              className="gap-2"
            >
              <CreatorIcon name={tool.icon} size={16} className="text-slate-500" />
              <span className="flex-1">{tool.label}</span>
              {tool.shortcut ? <span className="text-xs text-slate-400">{tool.shortcut}</span> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FloatingMapToolbar({
  activeTool,
  onToolChange,
  className,
}: {
  activeTool: MapTool;
  onToolChange: (_tool: MapTool) => void;
  className?: string;
}) {
  const [openMenu, setOpenMenu] = useState<'elements' | 'shapes' | null>(null);

  const handleMenuOpenChange = (menuId: 'elements' | 'shapes', open: boolean) => {
    setOpenMenu((current) => {
      if (open) return menuId;
      return current === menuId ? null : current;
    });
  };

  return (
    <div
      data-testid="map-toolbar"
      className={cn(
        `${MAP_TOOLBAR_SURFACE_CLASS} flex w-fit max-w-[calc(100vw-0.5rem)] flex-nowrap items-center gap-0 overflow-hidden px-1.5 sm:gap-0.5`,
        className,
      )}
    >
      {tools.map((tool) => {
        const active = activeTool === tool.id;
        return (
          <ToolbarButton
            key={tool.id}
            icon={tool.icon}
            label={tool.label}
            active={active}
            onClick={() => onToolChange(tool.id)}
          />
        );
      })}
      <ToolbarDropdown
        menuId="elements"
        label="Elementos"
        triggerIcon="elements"
        items={presetTools}
        activeTool={activeTool}
        onToolChange={onToolChange}
        open={openMenu === 'elements'}
        onOpenChange={handleMenuOpenChange}
      />
      <ToolbarDropdown
        menuId="shapes"
        label="Formas"
        triggerIcon="shape"
        items={shapeTools}
        activeTool={activeTool}
        onToolChange={onToolChange}
        open={openMenu === 'shapes'}
        onOpenChange={handleMenuOpenChange}
      />
    </div>
  );
}

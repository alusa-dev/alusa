'use client';
import type { MapTool } from '../store/event-map-editor-store';
import { CreatorIcon, type CreatorIconName } from '@/components/icons/hugeicons';

import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useState } from 'react';

type ToolbarTool = {
  id: MapTool;
  label: string;
  shortcut?: string;
  icon: CreatorIconName;
};

const presetTools: ToolbarTool[] = [
  { id: 'seat', label: 'Bloco de fileiras', shortcut: 'C', icon: 'block' },
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
  onToolChange: (tool: MapTool) => void;
  open: boolean;
  onOpenChange: (menuId: 'elements' | 'shapes', open: boolean) => void;
}) {
  const isActive = items.some((tool) => tool.id === activeTool);

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => onOpenChange(menuId, nextOpen)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100',
                isActive && 'bg-brand-accent text-white hover:bg-brand-accent hover:text-white',
              )}
              aria-label={label}
            >
              <CreatorIcon name={triggerIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="w-52">
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
  onToolChange: (tool: MapTool) => void;
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
    <TooltipProvider>
      <div
        data-testid="map-toolbar"
        className={cn(
          'flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-300/30 backdrop-blur',
          className,
        )}
      >
        {tools.map((tool) => {
          const active = activeTool === tool.id;
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onToolChange(tool.id)}
                  className={cn(
                    'h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100',
                    active && 'bg-brand-accent text-white hover:bg-brand-accent hover:text-white',
                  )}
                  aria-label={tool.label}
                >
                  <CreatorIcon name={tool.icon} size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {tool.label}
                {tool.shortcut ? <span className="ml-1 text-slate-400">({tool.shortcut})</span> : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <ToolbarDropdown
          menuId="elements"
          label="Elementos"
          triggerIcon="block"
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
    </TooltipProvider>
  );
}

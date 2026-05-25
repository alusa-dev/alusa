'use client';
import type { MapTool } from '../store/event-map-editor-store';

import { cn } from '@/lib/utils';

import type { ComponentType } from 'react';
import {
  Armchair,
  Ban,
  Box,
  Circle,
  Grid2X2,
  Hand,
  LayoutGrid,
  MousePointer2,
  PanelTop,
  Shapes,
  Rows3,
  Square,
  Table2,
  Type,
  ZoomIn,
} from 'lucide-react';

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

type ToolbarTool = {
  id: MapTool;
  label: string;
  shortcut?: string;
  icon: ComponentType<{ className?: string }>;
};

const presetTools: ToolbarTool[] = [
  { id: 'section', label: 'Adicionar setor', shortcut: 'S', icon: Square },
  { id: 'row', label: 'Adicionar fileira', shortcut: 'R', icon: Rows3 },
  { id: 'seat', label: 'Adicionar assento', shortcut: 'C', icon: Armchair },
  { id: 'table', label: 'Adicionar mesa', icon: Table2 },
  { id: 'stage', label: 'Adicionar palco', icon: PanelTop },
  { id: 'booth', label: 'Camarote', icon: Box },
  { id: 'blocked', label: 'Sessão bloqueada', icon: Ban },
  { id: 'corridor', label: 'Corredor', icon: Grid2X2 },
  { id: 'general', label: 'Área geral', icon: Circle },
];

const shapeTools: ToolbarTool[] = [
  { id: 'shape-square', label: 'Quadrado', icon: Square },
  { id: 'shape-circle', label: 'Círculo', icon: Circle },
  { id: 'shape-ellipse', label: 'Elipse', icon: Circle },
  { id: 'shape-triangle', label: 'Triângulo', icon: Shapes },
];

const tools: ToolbarTool[] = [
  { id: 'select', label: 'Selecionar', shortcut: 'V', icon: MousePointer2 },
  { id: 'pan', label: 'Mover canvas', shortcut: 'H', icon: Hand },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z', icon: ZoomIn },
  { id: 'text', label: 'Adicionar texto', shortcut: 'T', icon: Type },
];

function ToolbarDropdown({
  label,
  triggerIcon: TriggerIcon,
  items,
  activeTool,
  onToolChange,
}: {
  label: string;
  triggerIcon: ComponentType<{ className?: string }>;
  items: ToolbarTool[];
  activeTool: MapTool;
  onToolChange: (tool: MapTool) => void;
}) {
  const isActive = items.some((tool) => tool.id === activeTool);

  return (
    <DropdownMenu>
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
              <TriggerIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="w-52">
        {items.map((tool) => {
          const Icon = tool.icon;
          return (
            <DropdownMenuItem
              key={tool.id}
              data-testid={`toolbar-${tool.id}-tool`}
              onSelect={() => onToolChange(tool.id)}
              className="gap-2"
            >
              <Icon className="h-4 w-4 text-slate-500" />
              <span className="flex-1">{tool.label}</span>
              {tool.shortcut ? <span className="text-xs text-slate-400">{tool.shortcut}</span> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FloatingMapToolbar({ activeTool, onToolChange }: { activeTool: MapTool; onToolChange: (tool: MapTool) => void }) {
  return (
    <TooltipProvider>
      <div
        data-testid="map-toolbar"
        className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-300/30 backdrop-blur"
      >
        {tools.map((tool) => {
          const Icon = tool.icon;
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
                  <Icon className="h-4 w-4" />
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
          label="Presets"
          triggerIcon={LayoutGrid}
          items={presetTools}
          activeTool={activeTool}
          onToolChange={onToolChange}
        />
        <ToolbarDropdown
          label="Formas"
          triggerIcon={Shapes}
          items={shapeTools}
          activeTool={activeTool}
          onToolChange={onToolChange}
        />
      </div>
    </TooltipProvider>
  );
}

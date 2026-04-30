import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const TabsContext = React.createContext<{ variant?: 'default' | 'line' }>({ variant: 'default' });

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & { variant?: 'default' | 'line' }
>(({ variant = 'default', ...props }, ref) => (
  <TabsContext.Provider value={{ variant }}>
    <TabsPrimitive.Root ref={ref} {...props} />
  </TabsContext.Provider>
));
Tabs.displayName = TabsPrimitive.Root.displayName;

const tabsListVariants = cva(
  'inline-flex items-center text-slate-500',
  {
    variants: {
      variant: {
        default: 'justify-center h-10 rounded-xl bg-slate-200/50 p-1',
        line: 'justify-start h-[42px] bg-transparent p-0 gap-4',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>,
  VariantProps<typeof tabsListVariants> { }

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, variant, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    const activeVariant = variant ?? context.variant ?? 'default';
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(tabsListVariants({ variant: activeVariant }), className)}
        {...props}
      />
    );
  }
);
TabsList.displayName = TabsPrimitive.List.displayName;

const tabsTriggerVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/30 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'rounded-lg px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm',
        line: 'relative h-[42px] border-b-2 border-transparent px-2 pb-2.5 pt-2 text-slate-500 hover:text-slate-900 data-[state=active]:border-brand-accent data-[state=active]:text-brand-accent data-[state=active]:shadow-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
  VariantProps<typeof tabsTriggerVariants> { }

const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  ({ className, variant, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    const activeVariant = variant ?? context.variant ?? 'default';
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(tabsTriggerVariants({ variant: activeVariant }), className)}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/30',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };

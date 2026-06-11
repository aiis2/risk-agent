import { ScrollArea } from './ui/ScrollArea';

/**
 * Generic scrollable page wrapper for content pages (non-chat).
 * Uses Radix UI ScrollArea for consistent scrollbar styling.
 */
export function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="flex-1 bg-surface">
      {children}
    </ScrollArea>
  );
}

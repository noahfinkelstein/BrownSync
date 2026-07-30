import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../cn";
import { CloseGlyph } from "../icons/glyphs";
import { IconButton } from "./IconButton";

export type PanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Mono sub-line under the title (place · time · source). */
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** px; clamped to 94vw on small screens. */
  width?: number;
  /** Non-modal by default so the map behind stays interactive. */
  modal?: boolean;
  /** `data-testid` on the panel content — e2e hook (integration). */
  testId?: string;
  className?: string;
};

/**
 * Right slide-over shell — 1px line + the app's ONLY shadow (§6.1).
 * Detail views (event / place / org) compose their content inside.
 */
export function Panel({
  open,
  onOpenChange,
  title,
  sub,
  children,
  footer,
  width = 380,
  modal = false,
  testId,
  className,
}: PanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        {/* A scrim has to DIM. `bg-bg-base/60` was a 60% veil of the page
            colour — on a near-black page that dimmed; on white it is a white
            film over white and the map behind stayed at full strength. Seal
            brown at 40% keeps the veil inside the brand instead of dropping a
            neutral grey next to it. */}
        {modal && <Dialog.Overlay className="fixed inset-0 z-40 bg-brand-brown/40" />}
        <Dialog.Content
          aria-describedby={undefined}
          data-testid={testId}
          style={{ width, maxWidth: "94vw" }}
          className={cn(
            "bs-panel fixed inset-y-0 right-0 z-50 flex flex-col border-l border-line bg-bg-raised",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-16 font-medium tracking-tight text-text-primary">
                {title}
              </Dialog.Title>
              {sub && <div className="pt-0.5 font-mono text-12 text-text-secondary">{sub}</div>}
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label="Close panel">
                <CloseGlyph className="h-3.5 w-3.5" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 grow overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

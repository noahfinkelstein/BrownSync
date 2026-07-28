import type { ReactNode } from "react";
import { cn } from "../cn";

export type EmptyStateProps = {
  /** e.g. <CategoryIcon category="club" size={24} /> — rendered faint. */
  icon?: ReactNode;
  title: ReactNode;
  /** Real copy, not "no data" — say what to do next (§6.4). */
  body?: ReactNode;
  /** Usually a ghost <Button>. */
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-6 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="mb-2 text-text-faint">{icon}</div>}
      <div className="text-15 font-medium tracking-tight text-text-secondary">{title}</div>
      {body && <div className="max-w-[38ch] text-13 text-text-faint">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

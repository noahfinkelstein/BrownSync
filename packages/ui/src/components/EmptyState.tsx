import type { ReactNode } from "react";
import { cn } from "../cn";

export type EmptyStateProps = {
  /** e.g. <CategoryIcon category="club" size={24} /> — rendered muted. */
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
      {icon && <div className="mb-2 text-text-secondary">{icon}</div>}
      {/* Primary, not secondary: on a dark page the whole block sat at one
          quiet level and the title still separated from the body by weight
          alone. On paper the two secondary greys collapse into one grey
          paragraph, so the title takes the ink and the body keeps secondary. */}
      <div className="text-16 font-medium tracking-tight text-text-primary">{title}</div>
      {body && <div className="max-w-[38ch] text-14 text-text-secondary">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

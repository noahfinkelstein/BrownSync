import type { ReactNode } from "react";
import { cn } from "../cn";
import type { Density } from "../types";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Mono data column (timestamps, coords, counts). */
  mono?: boolean;
  /** CSS width, e.g. "80px" or "12ch". */
  width?: string;
};

export type DataTableProps<T> = {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  density?: Density;
  /** Rendered inside the table when rows is empty — pass an <EmptyState/>. */
  empty?: ReactNode;
  className?: string;
  "aria-label"?: string;
};

/** Dense data table: mono headers, hairline rows, no card chrome (§6.4). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = "dense",
  empty,
  className,
  "aria-label": ariaLabel,
}: DataTableProps<T>) {
  const pad = density === "comfortable" ? "py-2" : "py-1";
  return (
    <table aria-label={ariaLabel} className={cn("w-full border-collapse text-13", className)}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              style={col.width ? { width: col.width } : undefined}
              className={cn(
                "border-b border-line px-2 pb-1.5 text-left font-mono text-12 font-normal uppercase tracking-[0.08em] text-text-faint",
                col.align === "right" && "text-right",
              )}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty ? (
          <tr>
            <td colSpan={columns.length} className="px-2 py-4">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-line/60 transition-colors duration-150 ease-out hover:bg-bg-overlay/60"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-2 align-top",
                    pad,
                    col.align === "right" && "text-right",
                    col.mono && "font-mono text-12 text-text-secondary",
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

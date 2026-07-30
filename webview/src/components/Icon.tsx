import type {
  ReactNode,
} from "react";

const iconCodepoints = {
  refresh: "\ueb37",
  analyze: "\ueb03",
  data: "\uebb7",
  query: "\ueaf1",
  schema: "\ueb86",
  rowGroup: "\uebd2",
  chunk: "\ueace",
  pixel: "\ueb5f",
  file: "\ueae8",
  menu: "\ueb94",
  inspector: "\uebd1",
  close: "\uea76",
  previous: "\ueab5",
  next: "\ueab6",
  up: "\ueab7",
  down: "\ueab4",
  copy: "\uebcc",
  warning: "\uea6c",
  info: "\uea74",
} as const;

export type IconName = keyof typeof iconCodepoints;

export function Icon({
  name,
}: {
  readonly name: IconName;
}): ReactNode {
  return (
    <span className="codicon" aria-hidden="true">
      {iconCodepoints[name]}
    </span>
  );
}

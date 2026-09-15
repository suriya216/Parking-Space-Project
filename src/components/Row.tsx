import type { ReactNode } from "react";

import { COLORS } from "../theme";
import { cx } from "../styles/cx";
import type { TestId } from "@shared/testids";

import { Icon, type IconName } from "./Icon";
import s from "./Row.module.css";

export interface RowProps {
  icon?: IconName;
  label: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  right?: ReactNode;
  testId?: TestId;
  /**
   * Record-identity attributes (e.g. `data-vehicle-id`) for rows a test
   * needs to address individually. See RECORD_ATTR in shared/testids.
   */
  dataAttrs?: Record<string, string>;
}

/** The list row used by the profile menu and every list-style screen. */
export const Row = ({
  icon,
  label,
  value,
  onClick,
  danger,
  right,
  testId,
  dataAttrs,
}: RowProps) => (
  <div
    onClick={onClick}
    data-testid={testId}
    {...dataAttrs}
    className={cx(s.row, onClick && s.clickable)}
  >
    {icon && (
      <div className={s.iconBox}>
        {/* The icon takes a real colour, not a var(): it renders as an
            SVG `stroke` attribute set from JS. */}
        <Icon name={icon} size={18} color={danger ? COLORS.red : COLORS.blue} />
      </div>
    )}
    <div className={s.text}>
      <div className={cx(s.label, danger && s.danger)}>{label}</div>
      {value && <div className={s.value}>{value}</div>}
    </div>
    {right ?? (onClick && <span className={s.chevron}>›</span>)}
  </div>
);

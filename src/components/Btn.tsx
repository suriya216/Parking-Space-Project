import type { CSSProperties, ReactNode } from "react";

import { cx } from "../styles/cx";
import type { TestId } from "@shared/testids";

import s from "./Btn.module.css";

export type BtnVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type BtnSize = "sm" | "md" | "lg";

export interface BtnProps {
  children: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  full?: boolean;
  onClick?: (() => void) | undefined;
  /**
   * A request is in flight: dims the button and swallows further clicks,
   * so a double-tap can't fire a second request. Callers pass this rather
   * than juggling their own opacity style and an `onClick` ternary.
   */
  busy?: boolean;
  /**
   * Escape hatch for a genuine one-off. Reusable styling belongs in
   * Btn.module.css as a variant, and `busy` covers the common case.
   */
  style?: CSSProperties | undefined;
  testId?: TestId;
  ariaLabel?: string;
}

export const Btn = ({
  children,
  variant = "primary",
  size = "md",
  full,
  onClick,
  busy,
  style,
  testId,
  ariaLabel,
}: BtnProps) => (
  <button
    onClick={busy ? undefined : onClick}
    data-testid={testId}
    aria-label={ariaLabel}
    className={cx(s.btn, full && s.full, s[size], s[variant], busy && s.busy)}
    style={style}
  >
    {children}
  </button>
);

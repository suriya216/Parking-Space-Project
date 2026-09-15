import type { ReactNode } from "react";

import { cx } from "../styles/cx";

import s from "./Badge.module.css";

export type BadgeColor = "green" | "blue" | "orange" | "red" | "purple" | "gray";

export interface BadgeProps {
  children: ReactNode;
  color?: BadgeColor;
}

export const Badge = ({ children, color = "green" }: BadgeProps) => (
  <span className={cx(s.badge, s[color] ?? s.green)}>{children}</span>
);

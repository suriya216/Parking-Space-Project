import { cx } from "../styles/cx";

import s from "./Skeleton.module.css";

export interface SkeletonProps {
  /** Placeholder rows to draw. */
  rows?: number;
  /** Text announced to screen readers while loading. */
  label?: string;
}

/** Grey placeholder rows shown while a list is being fetched. */
export const Skeleton = ({ rows = 3, label = "Loading…" }: SkeletonProps) => (
  <div className={s.list} role="status" aria-busy="true">
    <span className={s.label}>{label}</span>
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className={s.row} aria-hidden="true">
        <div className={cx(s.block, s.thumb)} />
        <div className={s.text}>
          <div className={cx(s.block, s.line)} />
          <div className={cx(s.block, s.line, s.short)} />
        </div>
      </div>
    ))}
  </div>
);

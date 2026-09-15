import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

import { cx } from "../styles/cx";

import s from "./form.module.css";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
}

export const Field = ({ label, hint, className, ...props }: FieldProps) => (
  <label className={s.label}>
    <span className={s.labelText}>{label}</span>
    <input {...props} className={cx(s.control, className)} />
    {hint && <span className={s.hint}>{hint}</span>}
  </label>
);

/** A plain string option, or an explicit value/label pair. */
export type SelectOption = string | { value: string; label: string };

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  options: readonly SelectOption[];
}

export const Select = ({ label, options, className, ...props }: SelectProps) => (
  <label className={s.label}>
    <span className={s.labelText}>{label}</span>
    <select {...props} className={cx(s.control, s.select, className)}>
      {options.map((option) => {
        const value = typeof option === "string" ? option : option.value;
        const text = typeof option === "string" ? option : option.label;
        return (
          <option key={value} value={value}>
            {text}
          </option>
        );
      })}
    </select>
  </label>
);

export type NoticeTone = "error" | "success" | "info";

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
}

export const Notice = ({ tone = "error", children }: NoticeProps) => (
  <div className={cx(s.notice, s[tone])}>{children}</div>
);

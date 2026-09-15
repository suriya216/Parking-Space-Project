import { useEffect, type ReactNode } from "react";

import { COLORS } from "../theme";
import { cx } from "../styles/cx";
import { useBackGuard } from "../hooks/useBackGuard";
import { TID, type TestId } from "@shared/testids";

import { Icon } from "./Icon";
import s from "./Sheet.module.css";

export interface SheetProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  testId?: TestId;
}

/**
 * Bottom-sheet modal.
 *
 * Every form in the app opens in one of these, so the interaction is
 * consistent and there's a single place that handles backdrop dismissal,
 * Escape and the Back button. Styling is in Sheet.module.css.
 */
export const Sheet = ({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testId,
}: SheetProps) => {
  // Escape closes, matching the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Browser/Android Back closes the sheet rather than leaving the app.
  useBackGuard(true, onClose);

  return (
    <div onClick={onClose} className={s.backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid={testId ?? TID.sheet}
        className={s.panel}
      >
        <div className={s.header}>
          <div className={s.headerRow}>
            <div>
              <div data-testid={TID.sheetTitle} className={s.title}>
                {title}
              </div>
              {subtitle && <div className={s.subtitle}>{subtitle}</div>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              data-testid={TID.sheetClose}
              className={s.close}
            >
              <Icon name="x" size={16} color={COLORS.g600} />
            </button>
          </div>
        </div>
        <div className={s.body}>{children}</div>
        {footer && (
          /* ps-actionbar is global: it adds the home-indicator inset via
             env(), which a module cannot express. */
          <div className={cx("ps-actionbar", s.footer)}>{footer}</div>
        )}
      </div>
    </div>
  );
};

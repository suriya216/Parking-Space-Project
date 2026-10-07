import { useEffect, type ReactNode } from "react";

import { useBackGuard } from "../hooks/useBackGuard";
import { TID } from "@shared/testids";

import { Btn } from "./Btn";
import { Notice } from "./form";
import s from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Defaults on, since every
      current caller is a delete/cancel action. */
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered yes/no modal for actions that need a deliberate second step —
 * cancelling a booking, deleting a listing or a user. Replaces
 * `window.confirm()`, which is unstyled, blocks the JS thread, and can't
 * show a busy state or an error if the confirmed action fails.
 */
export const ConfirmDialog = ({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Browser/Android Back dismisses the dialog rather than leaving the app.
  useBackGuard(true, () => { if (!busy) onCancel(); });

  return (
    <div onClick={busy ? undefined : onCancel} className={s.backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid={TID.confirmDialog}
        role="alertdialog"
        aria-modal="true"
        className={s.panel}
      >
        <div className={s.title}>{title}</div>
        <div data-testid={TID.confirmDialogMessage} className={s.message}>{message}</div>
        {error && <div data-testid={TID.confirmDialogError}><Notice>{error}</Notice></div>}
        <div className={s.actions}>
          <Btn
            variant="ghost"
            full
            testId={TID.confirmDialogCancel}
            onClick={busy ? undefined : onCancel}
          >
            {cancelLabel}
          </Btn>
          <Btn
            variant={danger ? "danger" : "primary"}
            full
            busy={busy}
            testId={TID.confirmDialogConfirm}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
};

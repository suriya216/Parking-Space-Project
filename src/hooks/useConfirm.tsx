import { useCallback, useState, type ReactNode } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";

export interface ConfirmRequest {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Runs when the user confirms. Throwing keeps the dialog open and
      shows the error in it, same as any other form in the app. */
  action: () => Promise<void>;
}

/**
 * Imperative replacement for `window.confirm()` that also owns the busy
 * and error state of the confirmed action, so callers don't each need
 * their own `busy`/`err` pair just to wrap a delete button.
 *
 *   const { confirm, dialog } = useConfirm();
 *   confirm({ title: "Delete spot?", message: "...", action: () => api.deleteSpot(...) });
 *   return <>{dialog}{...}</>;
 */
export const useConfirm = () => {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = useCallback((req: ConfirmRequest) => {
    setError("");
    setRequest(req);
  }, []);

  const close = useCallback(() => {
    setRequest(null);
    setError("");
  }, []);

  const run = useCallback(async () => {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      await request.action();
      setBusy(false);
      setRequest(null);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, [request]);

  const dialog = request ? (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      danger={request.danger}
      busy={busy}
      error={error}
      onConfirm={run}
      onCancel={busy ? () => {} : close}
    />
  ) : null;

  return { confirm, dialog };
};

import { useEffect, useState } from "react";

import * as api from "../../api";
import { Btn } from "../../components";
import { cx } from "../../styles/cx";
import { TID } from "@shared/testids";

import s from "./AuthScreen.module.css";

export interface ResetPasswordScreenProps {
  /** The one-time token from the emailed link. */
  token: string;
  /** Called once the password is changed, or when the user gives up. */
  onDone: (outcome: "reset" | "cancel") => void;
}

type Phase = "checking" | "form" | "invalid";

/**
 * The page the emailed link opens. It checks the token first, so an
 * expired or already-used link says so up front instead of after the user
 * has typed a password. On success the app returns to the sign-in screen.
 */
export const ResetPasswordScreen = ({ token, onDone }: ResetPasswordScreenProps) => {
  const [phase, setPhase] = useState<Phase>("checking");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .checkPasswordReset(token)
      .then((valid) => {
        if (!cancelled) setPhase(valid ? "form" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setPhase("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (): Promise<void> => {
    if (!pass || !confirm) {
      setErr("Enter your new password twice.");
      return;
    }
    if (pass.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (pass !== confirm) {
      setErr("Those passwords don't match.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await api.confirmPasswordReset(token, pass);
      onDone("reset");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("ps-screen-min-h", s.screen)} data-testid={TID.resetScreen}>
      <div className={s.card}>
        <div className={s.wordmark}>
          Park<span className={s.wordmarkAccent}>Space</span>
        </div>
        <div className={s.tagline}>Your parking, simplified.</div>

        {phase === "checking" && <div className={s.heading}>Checking your link…</div>}

        {phase === "invalid" && (
          <>
            <div className={s.heading}>Link expired</div>
            <div data-testid={TID.resetInvalid} className={s.error}>
              This reset link is invalid or has expired. Request a new one from the
              sign-in screen.
            </div>
            <Btn full size="lg" testId={TID.resetBack} onClick={() => onDone("cancel")}>
              Back to sign in
            </Btn>
          </>
        )}

        {phase === "form" && (
          <>
            <div className={s.heading}>Choose a new password</div>

            <label className={s.label}>New password</label>
            <input
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              type="password"
              placeholder="At least 6 characters"
              autoComplete="new-password"
              data-testid={TID.resetPassword}
              className={s.input}
            />

            <label className={s.label}>Confirm new password</label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              type="password"
              placeholder="Re-enter password"
              autoComplete="new-password"
              data-testid={TID.resetConfirm}
              className={cx(s.input, s.inputTight)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />

            {err && (
              <div data-testid={TID.resetError} className={s.error}>
                {err}
              </div>
            )}

            <Btn full size="lg" testId={TID.resetSubmit} busy={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : "Reset password"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
};

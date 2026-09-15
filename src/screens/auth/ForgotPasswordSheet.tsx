import { useState } from "react";

import * as api from "../../api";
import { Btn, Field, Notice, Sheet } from "../../components";
import { cx } from "../../styles/cx";
import { TID } from "@shared/testids";
import type { PasswordResetResult } from "@shared/models";

import s from "./ForgotPasswordSheet.module.css";

export interface ForgotPasswordSheetProps {
  initialEmail?: string;
  onClose: () => void;
}

/**
 * The server has no mail transport, so this reports a simulated result
 * instead of implying a real email went out.
 */
export const ForgotPasswordSheet = ({
  initialEmail,
  onClose,
}: ForgotPasswordSheetProps) => {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [result, setResult] = useState<PasswordResetResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!email) {
      setErr("Enter your email address.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      setResult(await api.requestPasswordReset(email));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Reset your password"
      subtitle="We'll send a reset link to your email."
      onClose={onClose}
      testId={TID.forgotSheet}
      footer={
        result ? (
          <Btn full size="lg" onClick={onClose}>
            Back to sign in
          </Btn>
        ) : (
          <Btn full size="lg" testId={TID.forgotSubmit} busy={busy} onClick={submit}>
            {busy ? "Sending…" : "Send reset link"}
          </Btn>
        )
      }
    >
      {result ? (
        <div data-testid={TID.forgotResult}>
          <Notice tone="success">{result.message}</Notice>
          <Notice tone="info">{result.note}</Notice>
          <div className={s.explainer}>
            To wire this up for real you'd add an email service (SES, Postmark,
            Resend) plus a signed, expiring reset token — see the note on
            <code className={cx(s.code, s.codeInline)}>/api/password-reset</code>
            in <code className={s.code}>server/index.js</code>.
          </div>
        </div>
      ) : (
        <>
          {err && (
            <div data-testid={TID.forgotError}>
              <Notice>{err}</Notice>
            </div>
          )}
          <Field
            label="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            data-testid={TID.forgotEmail}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </>
      )}
    </Sheet>
  );
};

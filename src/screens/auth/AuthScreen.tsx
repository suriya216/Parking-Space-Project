import { useEffect, useState } from "react";

import * as api from "../../api";
import { Btn, Icon } from "../../components";
import { COLORS } from "../../theme";
import { cx } from "../../styles/cx";
import { TID } from "@shared/testids";
import type { AuthProviders, Role, Session } from "@shared/models";

import { ForgotPasswordSheet } from "./ForgotPasswordSheet";
import s from "./AuthScreen.module.css";

export interface AuthScreenProps {
  onLogin: (session: Session) => void;
  /** Surfaced from an OAuth round trip that came back with a problem. */
  notice?: string;
  onDismissNotice: () => void;
}

type Mode = "login" | "register";
type SelfServeRole = Extract<Role, "driver" | "owner">;

export const AuthScreen = ({ onLogin, notice, onDismissNotice }: AuthScreenProps) => {
  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<SelfServeRole>("driver");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  /* Set after a successful registration, cleared as soon as the user edits
     the form or switches mode again. */
  const [created, setCreated] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  /* Providers the server actually holds credentials for. Only these get a
     button — there is no fallback that fakes a sign-in. */
  const [providers, setProviders] = useState<AuthProviders["providers"]>([]);

  useEffect(() => {
    api
      .getAuthProviders()
      .then((d) => setProviders(d.providers))
      .catch(() => setProviders([]));
  }, []);

  const submit = async (): Promise<void> => {
    if (!email || !pass) {
      setErr("All fields are required.");
      return;
    }
    if (mode === "register" && !name) {
      setErr("Name is required.");
      return;
    }
    setErr("");
    setCreated("");
    setBusy(true);
    try {
      if (mode === "login") {
        onLogin(await api.login(email, pass));
        return;
      }
      /* Registering does not sign the new account in. The server hands
         back a session token, but using it would drop a user who has just
         chosen a password straight onto the dashboard without ever
         entering it. Return to the sign-in form instead, with the email
         kept and the password cleared, so the credentials get exercised
         against the database once. */
      await api.register({ name, email, password: pass, role });
      setMode("login");
      setName("");
      setPass("");
      setCreated("Account created. Sign in to continue.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("ps-screen-min-h", s.screen)} data-testid={TID.authScreen}>
      <div className={s.card}>
        <div className={s.wordmark}>
          Park<span className={s.wordmarkAccent}>Space</span>
        </div>
        <div className={s.tagline}>Your parking, simplified.</div>

        <div data-testid={TID.authHeading} className={s.heading}>
          {mode === "login" ? "Welcome back" : "Create account"}
        </div>

        {notice && (
          <div data-testid={TID.authNotice} className={s.notice}>
            <span className={s.noticeText}>{notice}</span>
            <button
              onClick={onDismissNotice}
              aria-label="Dismiss"
              data-testid={TID.authNoticeDismiss}
              className={s.noticeDismiss}
            >
              <Icon name="x" size={14} color={COLORS.textError} />
            </button>
          </div>
        )}

        {mode === "register" && (
          <>
            <label className={s.label}>I am a</label>
            <div className={s.roleRow}>
              {(["driver", "owner"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  data-testid={r === "driver" ? TID.authRoleDriver : TID.authRoleOwner}
                  className={cx(s.roleButton, role === r && s.roleButtonActive)}
                >
                  {r === "driver" ? "🚗 Driver" : "🏠 Space owner"}
                </button>
              ))}
            </div>
            <label className={s.label}>Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              data-testid={TID.authName}
              className={s.input}
            />
          </>
        )}

        <label className={s.label}>Email or phone</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          data-testid={TID.authEmail}
          className={s.input}
        />

        <label className={s.label}>Password</label>
        <input
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          type="password"
          placeholder="Enter password"
          data-testid={TID.authPassword}
          className={cx(s.input, s.inputTight)}
        />

        {mode === "login" && (
          <div className={s.forgotRow}>
            <button
              onClick={() => {
                setForgotOpen(true);
                setErr("");
              }}
              data-testid={TID.authForgot}
              className={s.forgotLink}
            >
              Forgot password?
            </button>
          </div>
        )}

        {created && (
          <div data-testid={TID.authRegistered} className={s.created}>
            {created}
          </div>
        )}

        {err && (
          <div data-testid={TID.authError} className={s.error}>
            {err}
          </div>
        )}

        <Btn full size="lg" testId={TID.authSubmit} busy={busy} onClick={submit}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </Btn>

        {/* The "Test accounts" quick-login panel used to sit here. It
            rendered each seed account's email AND plaintext password into
            the sign-in page, which is not something a login screen should
            ever do — and it made the UI suites depend on credentials being
            visible in the DOM. The credentials now live in the Playwright
            fixture layer (tests/fixtures/users.fixture.ts) and tests sign
            in the way a user does. */}

        {/* Social sign-in only exists when the server holds real
            credentials for a provider. With none configured the whole
            block is absent — no divider, no buttons — rather than
            offering something that cannot work. There is deliberately no
            demo fallback: a button that signs anyone in without
            credentials is worse than no button. */}
        {providers.length > 0 && (
          <>
            <div data-testid={TID.authSsoDivider} className={s.divider}>
              <div className={s.dividerRule} />
              <span>or</span>
              <div className={s.dividerRule} />
            </div>

            <div className={s.ssoRow}>
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => api.startOAuth(p.id)}
                  data-testid={TID.authSsoProvider}
                  className={cx(s.ssoButton, s.ssoButtonProvider)}
                >
                  Continue with {p.label}
                </button>
              ))}
            </div>
            <div className={s.ssoNote}>
              You'll be taken to {providers.length === 1 ? "the provider" : "them"} to
              sign in.
            </div>
          </>
        )}

        <div className={s.switchRow}>
          {mode === "login" ? (
            <>
              New here?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("register");
                  setErr("");
                  setCreated("");
                }}
                data-testid={TID.authSwitchToRegister}
                className={s.switchLink}
              >
                Create account
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("login");
                  setErr("");
                }}
                data-testid={TID.authSwitchToLogin}
                className={s.switchLink}
              >
                Sign in
              </a>
            </>
          )}
        </div>
      </div>

      {forgotOpen && (
        <ForgotPasswordSheet
          initialEmail={email}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </div>
  );
};

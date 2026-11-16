// Transactional email through Brevo's HTTP API (no SDK, just fetch).
//
// Configuration, all environment variables:
//   EMAIL_API_KEY   Brevo API key. Both the raw `xkeysib-...` form and the
//                   base64 JSON token Brevo sometimes hands out are accepted.
//   EMAIL_FROM      A sender verified in Brevo: `me@example.com` or
//                   `ParkSpace <me@example.com>`.
//
// With no key, nothing is sent. Outside production the message is kept in
// an in-memory outbox (and its link printed) so the flow can be exercised
// without an email account; in production it is simply dropped with a
// warning, because logging a reset link there would leak it.
//
// Addresses under `.test` are reserved (RFC 2606) and can never be
// delivered, so they are treated the same as "no key". That keeps the
// Playwright suite from spending real email quota on fake accounts.

const IS_PROD = process.env.NODE_ENV === "production";
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const apiKey = () => {
  const raw = (process.env.EMAIL_API_KEY ?? "").trim();
  if (!raw.startsWith("eyJ")) return raw;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return typeof decoded.api_key === "string" ? decoded.api_key : raw;
  } catch {
    return raw;
  }
};

// "Name <a@b.c>" or "a@b.c" -> { name?, email }
const parseSender = (value) => {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value ?? "");
  if (m) return { ...(m[1] ? { name: m[1] } : {}), email: m[2].trim() };
  return { name: "ParkSpace", email: String(value ?? "").trim() };
};

export const isConfigured = () =>
  Boolean(apiKey()) && Boolean(process.env.EMAIL_FROM);

// Newest last. Capped so a long-running dev server cannot grow it forever.
const outbox = [];
const OUTBOX_MAX = 50;

/** Latest captured message for an address (non-production only). */
export const lastCaptured = (to) =>
  [...outbox].reverse().find((m) => m.to.toLowerCase() === String(to).toLowerCase()) ?? null;

const capture = (message) => {
  if (IS_PROD) {
    console.warn("[mail] not sent: no EMAIL_API_KEY/EMAIL_FROM (or reserved .test address).");
    return;
  }
  outbox.push(message);
  if (outbox.length > OUTBOX_MAX) outbox.shift();
  console.log(`[mail] captured, not sent -> ${message.to}\n       ${message.text.split("\n").find((l) => l.includes("http")) ?? ""}`);
};

/**
 * Send one email. Resolves to "sent" or "captured"; rejects if Brevo
 * refuses it, so the caller can log the failure.
 */
export const sendMail = async ({ to, subject, html, text }) => {
  const undeliverable = /\.test$/i.test(to.split("@").pop() ?? "");
  if (!isConfigured() || undeliverable) {
    capture({ to, subject, text, html });
    return "captured";
  }

  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": apiKey(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: parseSender(process.env.EMAIL_FROM),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Status and Brevo's message only — never the request, which holds the key.
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return "sent";
};

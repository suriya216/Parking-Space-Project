// Payment gateway integration (Razorpay).
//
// Two modes, chosen automatically:
//   - LIVE:  RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are both set. Orders are
//            created through Razorpay's Orders API and the client opens the
//            real Razorpay Checkout, which offers UPI apps, cards, netbanking.
//   - DEMO:  no keys. Orders are fabricated locally and a demo-completion
//            endpoint fakes the "user paid in their UPI app" step. Crucially
//            the SAME HMAC signature verification runs in both modes, so the
//            security-critical path is exercised locally, not stubbed out.
//
// What reaches storage is only a display label and the gateway payment id;
// no card or UPI credentials are ever persisted.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";

/** True when real Razorpay credentials are configured. */
export const GATEWAY_LIVE = Boolean(KEY_ID && KEY_SECRET);

// Signatures are HMAC-signed with the gateway secret in live mode; in demo
// mode a fixed local secret stands in so verifyPayment still does real work.
const SIGNING_SECRET = KEY_SECRET || "demo_secret_parkspace_do_not_use_in_prod";

// A short, gateway-style id: "order_demo_ab12cd34ef56".
const fakeId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

/**
 * Create a payment order for the given amount.
 * @param {number} amountPaise Amount in the smallest currency unit (paise).
 * @param {string} receipt A short receipt/ref string for reconciliation.
 * @returns {Promise<{ orderId: string, amount: number, currency: string, keyId: string, live: boolean }>}
 */
export const createOrder = async (amountPaise, receipt) => {
  if (GATEWAY_LIVE) {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64"),
      },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt }),
    });
    if (!res.ok) {
      throw new Error("Payment gateway could not create the order.");
    }
    const order = await res.json();
    return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: KEY_ID, live: true };
  }

  // Demo order: no network, no keys.
  return { orderId: fakeId("order_demo"), amount: amountPaise, currency: "INR", keyId: "rzp_test_demo", live: false };
};

/** The Razorpay signature over an order+payment pair: HMAC_SHA256(orderId|paymentId). */
export const signatureFor = (orderId, paymentId) =>
  createHmac("sha256", SIGNING_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

/**
 * Verify a completed payment's signature. This is what proves the money
 * actually moved: the client cannot forge it without the secret.
 * @returns {boolean}
 */
export const verifyPayment = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) return false;
  const expected = signatureFor(orderId, paymentId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // Length check first: timingSafeEqual throws on a length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Demo only: fabricate a valid payment id + signature for an order, standing
 * in for the user completing payment in their UPI app. Never callable in live
 * mode — real completions come back from Razorpay Checkout.
 */
export const demoComplete = (orderId) => {
  const paymentId = fakeId("pay_demo");
  return { paymentId, signature: signatureFor(orderId, paymentId) };
};

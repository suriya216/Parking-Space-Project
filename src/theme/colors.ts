/**
 * Brand and surface colours.
 *
 * The values above the divider are tuned for fills, borders and icons —
 * several are too light to use for text on white. The `text*` entries are
 * darkened equivalents for text on a light background: an audit found
 * ~100 places where the palette above was used for small text at
 * 1.9–3.3:1 contrast, well under the 4.5:1 WCAG AA needs, with grey 11px
 * captions the worst of it. The ratios noted are against white.
 */
export const COLORS = {
  navy: "#0D1B2A",
  blue: "#1B4965",
  teal: "#5FA8D3",
  mint: "#62D2A2",
  lime: "#9BF19E",
  cream: "#F7F6F3",
  white: "#FFFFFF",

  g50: "#F8F9FA",
  g100: "#F1F3F5",
  g200: "#E9ECEF",
  g300: "#DEE2E6",
  g400: "#ADB5BD",
  g500: "#868E96",
  g600: "#495057",
  g700: "#343A40",
  g800: "#212529",

  red: "#E03131",
  orange: "#F08C00",
  yellow: "#FCC419",
  success: "#2F9E44",

  // ── Text colours ──────────────────────────────────────
  textSecondary: "#5A6472", // 6.0:1 — was g500
  textTertiary: "#6B7280", // 4.9:1 — was g400
  textLink: "#1B6C99", // 5.8:1 — was teal
  textWarning: "#B45309", // 5.1:1 — was orange (star ratings)
  textError: "#C62828", // 5.6:1 — was red (error messages)
  textSuccess: "#1E7B34", // 5.3:1 — was success (payout amounts)
  textBrand: "#15805A", // 4.9:1 — was mint, for text on light only
} as const;

export type ColorName = keyof typeof COLORS;

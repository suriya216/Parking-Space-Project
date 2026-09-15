/**
 * Keeps the CSS and TypeScript halves of the design system in step.
 *
 * `src/styles/tokens.css` is the source for anything written in CSS;
 * `src/theme/*.ts` is the source for anything handed to JavaScript — a
 * `var()` is no use to Leaflet's `pathOptions`, which writes SVG
 * attributes directly.
 *
 * Two sources means they can drift, which is exactly what happened
 * before tokens.css existed: #62d2a2, #0d1b2a and #5fa8d3 were written
 * out in index.css *and* defined again in theme/colors.ts. This spec is
 * the thing that makes the duplication safe.
 *
 * Runs in the `unit` project: no browser, no server.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { COLORS } from "../../../src/theme/colors";
import { Z } from "../../../src/theme/layers";
import { MIN_INPUT_FONT, fontB, fontD } from "../../../src/theme/typography";

const TOKENS_PATH = join("src", "styles", "tokens.css");
const tokensCss = readFileSync(TOKENS_PATH, "utf8");

/** Read one custom property's value out of tokens.css. */
const token = (name: string): string | null => {
  const match = tokensCss.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? null;
};

const normaliseColor = (value: string): string => {
  const hex = value.trim().toLowerCase();
  /* #fff and #ffffff are the same colour. */
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return hex;
};

/** TS colour key → CSS token name. */
const COLOR_TOKENS: Record<keyof typeof COLORS, string> = {
  navy: "ps-color-navy",
  blue: "ps-color-blue",
  teal: "ps-color-teal",
  mint: "ps-color-mint",
  lime: "ps-color-lime",
  cream: "ps-color-cream",
  white: "ps-color-white",
  g50: "ps-color-g50",
  g100: "ps-color-g100",
  g200: "ps-color-g200",
  g300: "ps-color-g300",
  g400: "ps-color-g400",
  g500: "ps-color-g500",
  g600: "ps-color-g600",
  g700: "ps-color-g700",
  g800: "ps-color-g800",
  red: "ps-color-red",
  orange: "ps-color-orange",
  yellow: "ps-color-yellow",
  success: "ps-color-success",
  textSecondary: "ps-text-secondary",
  textTertiary: "ps-text-tertiary",
  textLink: "ps-text-link",
  textWarning: "ps-text-warning",
  textError: "ps-text-error",
  textSuccess: "ps-text-success",
  textBrand: "ps-text-brand",
};

test.describe("design tokens", () => {
  test("every TypeScript colour has a matching CSS token", () => {
    for (const [key, tokenName] of Object.entries(COLOR_TOKENS)) {
      const cssValue = token(tokenName);
      expect(cssValue, `--${tokenName} is missing from ${TOKENS_PATH}`).not.toBeNull();

      const tsValue = COLORS[key as keyof typeof COLORS];
      expect(
        normaliseColor(cssValue!),
        `--${tokenName} (${cssValue}) should equal COLORS.${key} (${tsValue})`,
      ).toBe(normaliseColor(tsValue));
    }
  });

  test("every COLORS entry is covered by this spec", () => {
    /* Guards the guard: adding a colour to theme/colors.ts without a
       token would otherwise pass unnoticed. */
    const mapped = Object.keys(COLOR_TOKENS).sort();
    const actual = Object.keys(COLORS).sort();
    expect(actual).toEqual(mapped);
  });

  test("the z-index scale matches", () => {
    const zTokens: Record<keyof typeof Z, string> = {
      sheet: "ps-z-sheet",
      tabBar: "ps-z-tabbar",
      screenBar: "ps-z-screenbar",
      mapChrome: "ps-z-map-chrome",
      modal: "ps-z-modal",
    };

    for (const [key, tokenName] of Object.entries(zTokens)) {
      const cssValue = token(tokenName);
      expect(cssValue, `--${tokenName} is missing`).not.toBeNull();
      expect(Number(cssValue), `--${tokenName} should equal Z.${key}`).toBe(
        Z[key as keyof typeof Z],
      );
    }

    expect(Object.keys(Z).sort()).toEqual(Object.keys(zTokens).sort());
  });

  test("the font stacks match", () => {
    /* Quote style differs between the two files (CSS prefers double,
       the TS uses single), so compare with quotes stripped. */
    const stripQuotes = (v: string): string => v.replace(/['"]/g, "").trim();

    expect(stripQuotes(token("ps-font-display") ?? "")).toBe(stripQuotes(fontD));
    expect(stripQuotes(token("ps-font-body") ?? "")).toBe(stripQuotes(fontB));
  });

  test("the input font floor matches, and is still at least 16px", () => {
    expect(token("ps-font-size-input")).toBe(`${MIN_INPUT_FONT}px`);

    /* Not just equal to the constant — the constant itself must not drop
       below 16px, or iOS Safari zooms the page on focus. */
    expect(MIN_INPUT_FONT).toBeGreaterThanOrEqual(16);
  });

  test("tokens.css declares every hex as a token, never inside a rule", () => {
    /* Comments are stripped first: the file's own header explains which
       hexes used to be duplicated, and naming them is the point of that
       comment — not a violation. */
    const withoutComments = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");

    const offenders = withoutComments
      .split("\n")
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*--ps-/.test(line));

    expect(offenders, "every hex must be a --ps-* custom property").toEqual([]);
  });
});

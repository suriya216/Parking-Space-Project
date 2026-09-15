/**
 * Join class names, dropping anything falsy.
 *
 *   cx(s.btn, full && s.full, s[variant])
 *
 * A three-line local helper rather than a `clsx` dependency — this is
 * the entire surface the app needs from one.
 */
export const cx = (...names: Array<string | false | null | undefined>): string =>
  names.filter(Boolean).join(" ");

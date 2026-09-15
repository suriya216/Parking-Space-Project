/** Display face, for headings and numerals. */
export const fontD = "'Space Grotesk', system-ui, sans-serif";

/** Body face, for everything else. */
export const fontB = "'DM Sans', system-ui, sans-serif";

/**
 * A hard floor on every input's font size. iOS Safari zooms the whole
 * page when a focused field's text is smaller than 16px, which throws
 * the layout off and cannot be undone by the user.
 */
export const MIN_INPUT_FONT = 16;

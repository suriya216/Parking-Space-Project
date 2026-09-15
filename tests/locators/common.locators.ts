/**
 * Locators for app chrome that appears on more than one screen.
 *
 * The locator layer is deliberately separate from the page objects: a
 * locator module only *names* elements, it never acts on them. Page
 * objects own the behaviour. That split is what lets a markup change be
 * a one-file edit here, and keeps the page objects readable as user
 * intent rather than selector soup.
 */

import type { Locator, Page } from "@playwright/test";

import { TID } from "@shared/testids";
import type { RecordAttr, TestId } from "@shared/testids";

export const chromeLocators = (page: Page) => ({
  root: page.locator("#root"),

  tabBar: page.getByTestId(TID.tabBar),
  tabHome: page.getByTestId(TID.tabHome),
  tabSearch: page.getByTestId(TID.tabSearch),
  tabBookings: page.getByTestId(TID.tabBookings),
  tabSaved: page.getByTestId(TID.tabSaved),
  tabProfile: page.getByTestId(TID.tabProfile),

  screenTitle: page.getByTestId(TID.screenTitle),
  screenBack: page.getByTestId(TID.screenBack),
  signOut: page.getByTestId(TID.signOut),
});

export const sheetLocators = (page: Page) => ({
  container: page.getByTestId(TID.sheet),
  title: page.getByTestId(TID.sheetTitle),
  close: page.getByTestId(TID.sheetClose),
});

export type ChromeLocators = ReturnType<typeof chromeLocators>;
export type SheetLocators = ReturnType<typeof sheetLocators>;

/** Nth row of a repeated, test-id'd list. */
export const nthByTestId = (page: Page, id: string, index: number): Locator =>
  page.getByTestId(id).nth(index);

/**
 * A specific record's row: the shared test id plus the record-identity
 * attribute. See the RECORD_ATTR note in shared/testids.ts.
 */
export const recordLocator = (
  page: Page,
  testId: TestId,
  attr: RecordAttr,
  id: number | string,
): Locator => page.locator(`[data-testid="${testId}"][${attr}="${id}"]`);

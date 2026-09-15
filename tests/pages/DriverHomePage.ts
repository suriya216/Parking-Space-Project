import type { Page } from "@playwright/test";

import { TID } from "@shared/testids";
import {
  driverHomeLocators,
  filterLocators,
  locationPanelLocators,
} from "@locators/driver.locators";

import { BasePage } from "./BasePage";

/** Driver home: map, search, filters, location controls and the spot list. */
export class DriverHomePage extends BasePage {
  readonly el: ReturnType<typeof driverHomeLocators>;
  readonly filters: ReturnType<typeof filterLocators>;
  readonly location: ReturnType<typeof locationPanelLocators>;

  constructor(page: Page) {
    super(page);
    this.el = driverHomeLocators(page);
    this.filters = filterLocators(page);
    this.location = locationPanelLocators(page);
  }

  async waitForLoaded(): Promise<void> {
    await this.el.screen.waitFor({ state: "visible" });
    /* The list is populated from /api/spots after first paint, so wait for
       either real results or a settled empty/error state rather than
       sampling an empty DOM. */
    await this.page
      .locator(
        [TID.spotCard, TID.spotsEmpty, TID.spotsError]
          .map((id) => `[data-testid="${id}"]`)
          .join(", "),
      )
      .first()
      .waitFor({ state: "visible" });
  }

  async waitForMap(): Promise<void> {
    await this.el.map.waitFor({ state: "visible" });
  }

  async search(term: string): Promise<void> {
    await this.el.searchInput.fill(term);
  }

  async clearSearch(): Promise<void> {
    await this.el.searchClear.click();
  }

  /** Type and wait for the debounced (350ms) suggestion dropdown. */
  async searchAndAwaitSuggestions(term: string): Promise<void> {
    await this.search(term);
    await this.el.searchDropdown.waitFor({ state: "visible" });
  }

  async pickSpotSuggestion(index = 0): Promise<void> {
    await this.el.spotSuggestions.nth(index).click();
  }

  async pickPlaceSuggestion(index = 0): Promise<void> {
    await this.el.placeSuggestions.nth(index).click();
  }

  async openSpotByName(name: string): Promise<void> {
    await this.el.spotCardByName(name).first().click();
  }

  async openSpotAt(index = 0): Promise<void> {
    await this.el.spotCards.nth(index).click();
  }

  async spotCount(): Promise<number> {
    return this.el.spotCards.count();
  }

  async firstSpotName(): Promise<string> {
    return (await this.el.spotCards.first().textContent()) ?? "";
  }

  async toggleFavouriteAt(index = 0): Promise<void> {
    await this.el.favouriteToggle.nth(index).click();
  }

  /* ─── filters ─────────────────────────────────────────── */

  async openFilters(): Promise<void> {
    await this.el.filterButton.click();
    await this.filters.sheet.waitFor({ state: "visible" });
  }

  /**
   * Max price is `<input type="range">` driven by React state, so it
   * can't be `fill()`ed — Playwright refuses to type into a range input,
   * and setting `.value` directly is invisible to React because React
   * tracks the value on its own descriptor. Going through the native
   * setter and then dispatching a bubbling `input` event is what makes
   * the controlled component actually update.
   */
  async setMaxPrice(price: number): Promise<void> {
    await this.filters.maxPrice.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, price);
  }

  async applyMaxPrice(price: number): Promise<void> {
    await this.openFilters();
    await this.setMaxPrice(price);
    await this.filters.apply.click();
    await this.filters.sheet.waitFor({ state: "detached" });
  }

  async sortBy(order: "distance" | "price" | "rating"): Promise<void> {
    await this.openFilters();
    await this.filters.sort.selectOption(order);
    await this.filters.apply.click();
    await this.filters.sheet.waitFor({ state: "detached" });
  }

  async showVerifiedOnly(): Promise<void> {
    await this.openFilters();
    await this.filters.verifiedOnly.check();
    await this.filters.apply.click();
    await this.filters.sheet.waitFor({ state: "detached" });
  }

  async resetFilters(): Promise<void> {
    await this.openFilters();
    await this.filters.reset.click();
    await this.filters.sheet.waitFor({ state: "detached" });
  }

  /* ─── location ────────────────────────────────────────── */

  async toggleScope(): Promise<void> {
    await this.location.toggleScope.click();
  }

  /**
   * Tap the map at a proportional offset (0..1 of width/height).
   *
   * A real touch event, not `mouse.click`. Leaflet installs a touch/
   * pointer path on any touch-capable context and ignores synthetic mouse
   * clicks there — which WebKit tolerated but Chromium's Android
   * emulation did not, so pin-picking silently did nothing on Android
   * only. Every UI project sets `hasTouch`, so `tap()` is valid in all
   * of them, including desktop.
   */
  async tapMapAt(xFraction = 0.5, yFraction = 0.4): Promise<void> {
    const box = await this.waitForStableMapBox();
    /* `position` is relative to the element, so no page offset needed. */
    await this.el.map.tap({
      position: { x: box.width * xFraction, y: box.height * yFraction },
    });
  }

  /**
   * Tap a part of the map with no marker on it.
   *
   * Tapping a fixed fraction is not safe: a price marker there swallows
   * the tap and opens its popup instead, so pin-picking appears to do
   * nothing. It bit Android hardest — that viewport gives the map ~378px
   * of height against iOS's 180px cap, so the markers spread out — and
   * only under parallel load, because the owner specs add listings and
   * every extra listing is another marker that might be in the way.
   *
   * So: measure the markers and pick a gap, rather than hoping.
   */
  async tapEmptyMapArea(): Promise<void> {
    const box = await this.waitForStableMapBox();
    const mapBox = await this.el.map.boundingBox();
    if (!mapBox) throw new Error("map has no bounding box — is it rendered?");

    /* Price tags and the device dot both intercept taps. */
    const occupied = await this.page
      .locator(".ps-price-marker, .ps-user-marker")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }),
      );

    /* Keep clear of the search row at the top and the spot sheet, which
       overlaps the map's bottom edge by 24px. */
    const PADDING = 28;
    const candidates: Array<{ x: number; y: number }> = [];
    for (const yFraction of [0.5, 0.42, 0.58, 0.35, 0.65, 0.3, 0.7]) {
      for (const xFraction of [0.5, 0.25, 0.75, 0.15, 0.85, 0.35, 0.65]) {
        candidates.push({ x: box.width * xFraction, y: box.height * yFraction });
      }
    }

    const clear = candidates.find((point) => {
      const pageX = mapBox.x + point.x;
      const pageY = mapBox.y + point.y;
      return occupied.every(
        (r) =>
          pageX < r.left - PADDING ||
          pageX > r.right + PADDING ||
          pageY < r.top - PADDING ||
          pageY > r.bottom + PADDING,
      );
    });

    if (!clear) {
      throw new Error(
        `no marker-free point found on the map (${occupied.length} markers in a ` +
          `${Math.round(box.width)}x${Math.round(box.height)} viewport)`,
      );
    }

    await this.el.map.tap({ position: clear });
  }

  /**
   * Wait until the map stops resizing, then return its box.
   *
   * MapController watches the container with a ResizeObserver and calls
   * `invalidateSize()` whenever it changes — and the container is a flex
   * child with a percentage height, so it settles after first paint and
   * again as tiles arrive. Measuring once and then tapping raced that:
   * the coordinates were computed against a box the map had already
   * moved on from, and the tap missed. Under parallel load, on Android,
   * that was reliably reproducible.
   */
  private async waitForStableMapBox(): Promise<{ width: number; height: number }> {
    await this.el.map.waitFor({ state: "visible" });

    let previous: { width: number; height: number } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const box = await this.el.map.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        if (
          previous &&
          Math.abs(previous.width - box.width) < 1 &&
          Math.abs(previous.height - box.height) < 1
        ) {
          return box;
        }
        previous = { width: box.width, height: box.height };
      }
      await this.page.waitForTimeout(150);
    }

    if (!previous) throw new Error("map never reported a usable bounding box");
    return previous;
  }

  /**
   * Enter pin-picking mode from the map's own control and drop a pin.
   *
   * Only usable when the inline control is actually rendered — it appears
   * only if the device fix is missing or coarser than ~5 km. With a good
   * geolocation, go via ProfilePage.startPinningLocation() instead.
   */
  async pinLocationFromMap(): Promise<void> {
    await this.location.setPin.click();
    await this.location.pickingBanner.waitFor({ state: "visible" });
    /* Marker-free, so a price marker cannot swallow the pick. */
    await this.tapEmptyMapArea();
    await this.location.pickingBanner.waitFor({ state: "detached" });
  }

  async clearPinnedLocation(): Promise<void> {
    await this.location.clearPin.click();
  }

  /* ─── tabs ────────────────────────────────────────────── */

  async goToBookings(): Promise<void> {
    await this.chrome.tabBookings.click();
  }

  async goToSaved(): Promise<void> {
    await this.chrome.tabSaved.click();
  }

  async goToProfile(): Promise<void> {
    await this.chrome.tabProfile.click();
  }

  async goToHome(): Promise<void> {
    await this.chrome.tabHome.click();
  }
}

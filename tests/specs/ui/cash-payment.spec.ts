/**
 * Paying the owner in cash.
 *
 * A cash booking is created unpaid. Only the owner of the spot can say the
 * cash arrived, and when they do the driver is told on the Bookings tab.
 * The driver's app notices on its own: while a cash payment is outstanding
 * it re-checks every 30 seconds, which these specs skip with a fake clock.
 */

import { BOOKING_HOURS } from "@fixtures/data.fixture";
import { USERS, expect, injectSession, newAccount, test } from "@fixtures/index";
import { TID } from "@shared/testids";

const OWNED_SPOT = "Lakshmi Residency";

test.describe("cash payment confirmation", () => {
  test("the driver is told, once, when the owner confirms the cash", async ({
    page,
    api,
    driverHome,
    bookings,
  }) => {
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    const spot = (await api.spots()).data.spots.find((s) => s.name === OWNED_SPOT);
    expect(spot, `seeded spot "${OWNED_SPOT}" must exist`).toBeDefined();

    const driver = await api.register(newAccount("driver"));
    const created = await api.createBooking(driver.data.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.minimum,
    });
    const booking = created.data.booking;
    expect(booking.payment_status).toBe("pending");

    await page.clock.install();
    await injectSession(page, driver.data);
    await driverHome.waitForLoaded();

    await bookings.openFromTab();
    await expect(bookings.el.cardByRef(booking.ref)).toBeVisible();
    await expect(bookings.el.paidNotice).toHaveCount(0);

    /* Away from the Bookings tab, where only the badge can speak up. */
    await driverHome.chrome.tabHome.click();

    const confirmed = await api.confirmCashReceived(owner.token, booking.id);
    expect(confirmed.status).toBe(200);
    await page.clock.fastForward(31_000);

    await expect(bookings.el.tabBadge).toBeVisible();
    await bookings.openFromTab();
    await expect(bookings.el.paidNotice).toContainText(booking.ref);
    await expect(bookings.el.tabBadge).toHaveCount(0);

    /* Seen: it does not come back. */
    await driverHome.chrome.tabHome.click();
    await bookings.openFromTab();
    await expect(bookings.el.paidNotice).toHaveCount(0);
  });

  test("the owner records the cash from their dashboard", async ({
    page,
    api,
    signIn,
  }) => {
    /* A fresh driver, so their name picks out this booking's row on the
       owner's list (the row shows the name, not the reference). */
    const account = newAccount("driver");
    const driver = await api.register(account);
    const spot = (await api.spots()).data.spots.find((s) => s.name === OWNED_SPOT);
    expect(spot, `seeded spot "${OWNED_SPOT}" must exist`).toBeDefined();
    const created = await api.createBooking(driver.data.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.minimum,
    });
    const booking = created.data.booking;

    await signIn("owner");
    const row = page
      .locator("div")
      .filter({ hasText: account.name, has: page.getByTestId(TID.bookingCashReceived) })
      .last();
    await row.getByTestId(TID.bookingCashReceived).click();
    await page.getByRole("button", { name: /yes, cash received/i }).click();

    await expect
      .poll(async () => {
        const list = await api.bookings(driver.data.token);
        return list.data.bookings.find((b) => b.id === booking.id)?.payment_status;
      })
      .toBe("confirmed");
  });
});

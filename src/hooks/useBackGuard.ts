import { useEffect, useRef } from "react";

import { pushGuard } from "../backstack";

/**
 * Make browser/Android Back close this view instead of leaving the site.
 *
 * The app is a single route, so without this the Back button would exit
 * the app entirely rather than closing whatever is open. The shared LIFO
 * stack lives in ../backstack.ts, which is where the reasoning for
 * centralising it is written down — and which can be unit-tested without
 * a browser.
 *
 * @param active whether this view is currently open
 * @param onBack what to do when Back is pressed
 */
export const useBackGuard = (active: boolean, onBack: () => void): void => {
  /* Held in a ref so a changing callback identity doesn't tear down and
     re-push the history entry on every render. */
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    return pushGuard(() => callback.current());
  }, [active]);
};

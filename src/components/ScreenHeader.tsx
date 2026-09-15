import type { ReactNode } from "react";

import { COLORS } from "../theme";
import { TID } from "@shared/testids";

import { Icon } from "./Icon";
import s from "./ScreenHeader.module.css";

export interface ScreenHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}

/**
 * Header for the secondary tabs.
 *
 * Gives them a visible way back to Home, so navigation doesn't depend on
 * spotting the right icon in the tab bar.
 */
export const ScreenHeader = ({ title, onBack, action }: ScreenHeaderProps) => (
  <div className={s.header}>
    {onBack && (
      <button
        onClick={onBack}
        aria-label="Back to home"
        data-testid={TID.screenBack}
        className={s.back}
      >
        <Icon name="back" size={18} color={COLORS.navy} />
      </button>
    )}
    <div data-testid={TID.screenTitle} className={s.title}>
      {title}
    </div>
    {action}
  </div>
);

/**
 * Profile screen and the sheets it opens (edit profile, vehicles, payment
 * methods, settings, safety & privacy).
 */

import type { Page } from "@playwright/test";

import { RECORD_ATTR, TID } from "@shared/testids";

import { recordLocator } from "./common.locators";

export const profileLocators = (page: Page) => ({
  screen: page.getByTestId(TID.profileScreen),
  name: page.getByTestId(TID.profileName),
  email: page.getByTestId(TID.profileEmail),
  rows: page.getByTestId(TID.profileRow),
  rowByLabel: (label: string) =>
    page.getByTestId(TID.profileRow).filter({ hasText: label }),
});

export const editProfileLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.editProfileSheet),
  name: page.getByTestId(TID.editProfileName),
  email: page.getByTestId(TID.editProfileEmail),
  phone: page.getByTestId(TID.editProfilePhone),
  save: page.getByTestId(TID.editProfileSave),
  error: page.getByTestId(TID.editProfileError),
});

export const vehiclesLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.vehiclesSheet),
  rows: page.getByTestId(TID.vehicleRow),
  rowById: (id: number) =>
    recordLocator(page, TID.vehicleRow, RECORD_ATTR.vehicle, id),
  rowByPlate: (plate: string) =>
    page.getByTestId(TID.vehicleRow).filter({ hasText: plate }),
  label: page.getByTestId(TID.vehicleLabel),
  plate: page.getByTestId(TID.vehiclePlate),
  type: page.getByTestId(TID.vehicleType),
  add: page.getByTestId(TID.vehicleAdd),
  deleteButtons: page.getByTestId(TID.vehicleDelete),
  empty: page.getByTestId(TID.vehiclesEmpty),
});

export const cardsLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.cardsSheet),
  rows: page.getByTestId(TID.cardRow),
  rowById: (id: number) => recordLocator(page, TID.cardRow, RECORD_ATTR.card, id),
  number: page.getByTestId(TID.cardNumber),
  expiry: page.getByTestId(TID.cardExpiry),
  add: page.getByTestId(TID.cardAdd),
  deleteButtons: page.getByTestId(TID.cardDelete),
  error: page.getByTestId(TID.cardError),
});

export const settingsLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.settingsSheet),
  units: page.getByTestId(TID.settingsUnits),
  radius: page.getByTestId(TID.settingsRadius),
  defaultHours: page.getByTestId(TID.settingsDefaultHours),
  save: page.getByTestId(TID.settingsSave),
  pickLocation: page.getByTestId(TID.settingsPickLocation),
  clearLocation: page.getByTestId(TID.settingsClearLocation),
});

export const safetyLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.safetySheet),
});

export type ProfileLocators = ReturnType<typeof profileLocators>;
export type EditProfileLocators = ReturnType<typeof editProfileLocators>;
export type VehiclesLocators = ReturnType<typeof vehiclesLocators>;
export type CardsLocators = ReturnType<typeof cardsLocators>;
export type SettingsLocators = ReturnType<typeof settingsLocators>;
export type SafetyLocators = ReturnType<typeof safetyLocators>;

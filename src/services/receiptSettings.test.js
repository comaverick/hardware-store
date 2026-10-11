import {
  DEFAULT_RECEIPT_SETTINGS,
  getReceiptSettings,
  RECEIPT_SETTINGS_KEY,
  saveReceiptSettings,
} from "./receiptSettings";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test("preserves automatic printing for existing workstations and recovers from malformed saved data", () => {
  expect(getReceiptSettings()).toEqual(DEFAULT_RECEIPT_SETTINGS);
  localStorage.setItem(RECEIPT_SETTINGS_KEY, "invalid json");
  expect(getReceiptSettings()).toEqual(DEFAULT_RECEIPT_SETTINGS);
  localStorage.setItem(
    RECEIPT_SETTINGS_KEY,
    JSON.stringify({
      storeName: false,
      receiptFooter: null,
      autoPrint: "false",
    }),
  );
  expect(getReceiptSettings()).toEqual(DEFAULT_RECEIPT_SETTINGS);
});

test.each(["SUPER_ADMIN", "ADMIN"])(
  "%s can persist receipt preferences across reads",
  (role) => {
    saveReceiptSettings(
      {
        storeName: "  Builder Supply  ",
        receiptFooter: "Thank you!\nSee you soon.",
        autoPrint: false,
      },
      role,
    );
    expect(getReceiptSettings()).toEqual({
      storeName: "Builder Supply",
      receiptFooter: "Thank you!\nSee you soon.",
      autoPrint: false,
    });
  },
);

test("removes printer control characters while preserving footer line breaks", () => {
  saveReceiptSettings(
    {
      storeName: "Store\u001b\u0000",
      receiptFooter: "Thanks\n\u001b\u001dVisit again",
      autoPrint: true,
      unknownSetting: "ignored",
    },
    "SUPER_ADMIN",
  );
  const settings = getReceiptSettings();
  expect(settings.storeName).toBe("Store");
  expect(settings.receiptFooter).toBe("Thanks\n  Visit again");
  expect(settings.unknownSetting).toBeUndefined();
});

test("does not report a save when browser storage is unavailable", () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  expect(() =>
    saveReceiptSettings({ storeName: "New Store" }, "ADMIN"),
  ).toThrow("Storage blocked");
});

test.each(["MANAGER", "CASHIER", "INVENTORY_STAFF", "UNKNOWN", undefined])(
  "%s cannot overwrite saved receipt preferences",
  (role) => {
    saveReceiptSettings({ storeName: "Approved Store" }, "ADMIN");
    const saved = localStorage.getItem(RECEIPT_SETTINGS_KEY);
    expect(() =>
      saveReceiptSettings({ storeName: "Changed Store" }, role),
    ).toThrow("Only administrators can change receipt settings.");
    expect(localStorage.getItem(RECEIPT_SETTINGS_KEY)).toBe(saved);
    expect(getReceiptSettings().storeName).toBe("Approved Store");
  },
);

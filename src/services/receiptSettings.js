export const RECEIPT_SETTINGS_KEY = "hardware-store:receipt-settings:v1";

export const DEFAULT_RECEIPT_SETTINGS = {
  storeName: "HARDWARE STORE",
  receiptFooter: "Thank you for your purchase!\nPlease come again.",
  autoPrint: true,
};

export const canManageReceiptSettings = (role) =>
  ["SUPER_ADMIN", "ADMIN"].includes(role);

const cleanText = (value, fallback, maxLength, multiline = false) => {
  if (typeof value !== "string") return fallback;
  const text = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return (code >= 32 && code !== 127) || (multiline && character === "\n")
      ? character
      : " ";
  })
    .join("")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
};

const normalizeSettings = (value) => ({
  storeName: cleanText(value?.storeName, DEFAULT_RECEIPT_SETTINGS.storeName, 80),
  receiptFooter: cleanText(
    value?.receiptFooter,
    DEFAULT_RECEIPT_SETTINGS.receiptFooter,
    200,
    true,
  ),
  autoPrint: typeof value?.autoPrint === "boolean" ? value.autoPrint : true,
});

export const getReceiptSettings = () => {
  try {
    return normalizeSettings(
      JSON.parse(localStorage.getItem(RECEIPT_SETTINGS_KEY)),
    );
  } catch {
    return { ...DEFAULT_RECEIPT_SETTINGS };
  }
};

export const saveReceiptSettings = (values, role) => {
  if (!canManageReceiptSettings(role)) {
    throw new Error("Only administrators can change receipt settings.");
  }
  const settings = normalizeSettings(values);
  // Let storage failures reach the form so it never reports an unsuccessful save as saved.
  localStorage.setItem(RECEIPT_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
};

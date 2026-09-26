export const createRequestKey = () =>
  (typeof window !== "undefined" && window.crypto?.randomUUID?.()) ||
  `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;

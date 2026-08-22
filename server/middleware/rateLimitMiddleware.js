const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const createRateLimiter = ({
  limit,
  windowMs = DEFAULT_WINDOW_MS,
  message = "Too many requests. Please try again later.",
} = {}) => {
  const buckets = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, windowMs);

  // Do not keep the Node process alive only for rate-limit cleanup.
  cleanup.unref?.();

  return (req, res, next) => {
    // Health checks are used by monitoring and the application shell.
    if (req.path === "/health") {
      return next();
    }

    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000),
      );

      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    return next();
  };
};

const apiRateLimiter = createRateLimiter({
  limit: 300,
  message: "Too many API requests. Please try again later.",
});

const authRateLimiter = createRateLimiter({
  limit: 10,
  message: "Too many authentication attempts. Please try again later.",
});

const aiRateLimiter = createRateLimiter({
  limit: 30,
  message: "Too many AI requests. Please try again later.",
});

module.exports = {
  apiRateLimiter,
  authRateLimiter,
  aiRateLimiter,
};

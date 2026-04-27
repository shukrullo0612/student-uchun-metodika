const buckets = new Map();

export const createRateLimiter = ({ windowMs, max, keySelector }) => {
  return (req, res, next) => {
    const now = Date.now();
    const key = keySelector ? keySelector(req) : req.ip;

    const current = buckets.get(key) || [];
    const active = current.filter((timestamp) => now - timestamp < windowMs);

    if (active.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - active[0])) / 1000);
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        message: 'Too many attempts. Try again later.',
        retryAfter,
      });
    }

    active.push(now);
    buckets.set(key, active);
    return next();
  };
};

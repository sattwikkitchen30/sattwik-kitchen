'use strict';

/**
 * In-memory sliding-window rate limiter for password reset and authentication endpoints.
 */
const requestMap = new Map();

function checkRateLimit(key, { max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const cleanKey = String(key || '').trim().toLowerCase();
  if (!cleanKey) return { allowed: true, remaining: max, retryAfterSeconds: 0 };

  let timestamps = requestMap.get(cleanKey) || [];
  // Evict timestamps outside the window
  timestamps = timestamps.filter((t) => now - t < windowMs);

  if (timestamps.length >= max) {
    const oldest = timestamps[0];
    const retryAfterMs = windowMs - (now - oldest);
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds
    };
  }

  timestamps.push(now);
  requestMap.set(cleanKey, timestamps);

  return {
    allowed: true,
    remaining: max - timestamps.length,
    retryAfterSeconds: 0
  };
}

function resetRateLimits() {
  requestMap.clear();
}

module.exports = {
  checkRateLimit,
  resetRateLimits
};

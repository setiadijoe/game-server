import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitCategory = "read" | "write";

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export interface ApiRateLimiter {
  limit(identifier: string, category: RateLimitCategory): Promise<RateLimitResult>;
}

export const READ_REQUESTS_PER_MINUTE = 120;
export const WRITE_REQUESTS_PER_MINUTE = 10;

export interface RateLimitConfig {
  url: string;
  token: string;
}

export function getRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env
): RateLimitConfig {
  if (env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_TOKEN) {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        "Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN"
      );
    }
    return {
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN
    };
  }
  if (env.KV_REST_API_URL || env.KV_REST_API_TOKEN) {
    if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) {
      throw new Error("Set both KV_REST_API_URL and KV_REST_API_TOKEN");
    }
    return {
      url: env.KV_REST_API_URL,
      token: env.KV_REST_API_TOKEN
    };
  }

  const prefixedConfigs = Object.keys(env)
    .filter((name) => /^REDIS_.+_KV_REST_API_URL$/.test(name))
    .flatMap((urlName) => {
      const prefix = urlName.slice(0, -"_KV_REST_API_URL".length);
      const url = env[urlName];
      const token = env[`${prefix}_KV_REST_API_TOKEN`];
      return url && token ? [{ url, token }] : [];
    });

  if (prefixedConfigs.length === 1) return prefixedConfigs[0];
  if (prefixedConfigs.length > 1) {
    throw new Error(
      "Multiple prefixed Redis REST configurations found; set " +
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to select one"
    );
  }

  throw new Error(
    "Set a Redis REST URL and write token. Read-only tokens cannot update rate-limit counters."
  );
}

export function createRateLimiter(): ApiRateLimiter {
  const redis = new Redis(getRateLimitConfig());
  const readLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(READ_REQUESTS_PER_MINUTE, "1 m"),
    prefix: "game-server:read",
    analytics: false,
    enableTelemetry: false
  });
  const writeLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(WRITE_REQUESTS_PER_MINUTE, "1 m"),
    prefix: "game-server:write",
    analytics: false,
    enableTelemetry: false
  });

  return {
    limit(identifier, category) {
      return category === "read"
        ? readLimiter.limit(identifier)
        : writeLimiter.limit(identifier);
    }
  };
}

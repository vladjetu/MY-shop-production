import { Redis } from "@upstash/redis";

// Upstash Redis je pripojený cez Vercel Marketplace, ktorý nastaví KV_REST_API_URL /
// KV_REST_API_TOKEN (Redis.fromEnv() číta tie aj UPSTASH_REDIS_REST_*). Chýbajúce env
// → null namiesto výnimky, appka musí bežať aj bez SAP snapshotu.
export function getSapRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return Redis.fromEnv();
}

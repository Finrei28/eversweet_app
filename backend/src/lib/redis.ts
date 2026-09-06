import Redis from "ioredis"

const redisUrl = process.env.REDIS_URL!

/**
 * One connection for the process. The rate limiters and the idempotency
 * middleware both need Redis, and a managed instance hands out a small
 * connection pool — opening a client per module spends those for nothing.
 */
export const redis = new Redis(redisUrl)

redis.on("error", (error) => console.log("Redis Error:", error))

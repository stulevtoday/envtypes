const port = Bun.env.PORT || "3000";
const apiKey = Bun.env.API_KEY;
const { REDIS_URL, CACHE_TTL = "600" } = Bun.env;

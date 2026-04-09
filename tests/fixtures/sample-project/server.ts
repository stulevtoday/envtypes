import express from "express";

const app = express();

const port = Number(process.env.PORT || "3000");
const host = process.env.HOST ?? "0.0.0.0";
const dbUrl = process.env.DATABASE_URL;
const nodeEnv = process.env.NODE_ENV;

const { REDIS_URL, CACHE_TTL = "3600" } = process.env;

const apiKey = process.env["API_KEY"];
const secretToken = process.env["SECRET_TOKEN"];

if (process.env.ENABLE_LOGGING === "true") {
  console.log("Logging enabled");
}

const maxRetries = Number(process.env.MAX_RETRIES ?? "3");

const verbose = process.env.VERBOSE ? process.env.VERBOSE : "false";

app.listen(port, host, () => {
  console.log(`Server running on ${host}:${port} in ${nodeEnv} mode`);
});

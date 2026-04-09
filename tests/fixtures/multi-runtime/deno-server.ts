const port = Deno.env.get("PORT") ?? "8000";
const dbUrl = Deno.env.get("DATABASE_URL");
const debug = Deno.env.get("DEBUG");

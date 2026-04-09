import fs from "node:fs";
import path from "node:path";

export interface FrameworkInfo {
  name: string;
  clientPrefix: string | null;
  envAccess: "process.env" | "import.meta.env" | "both";
  configFiles: string[];
}

const FRAMEWORKS: FrameworkInfo[] = [
  {
    name: "next",
    clientPrefix: "NEXT_PUBLIC_",
    envAccess: "process.env",
    configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
  },
  {
    name: "vite",
    clientPrefix: "VITE_",
    envAccess: "import.meta.env",
    configFiles: ["vite.config.ts", "vite.config.js", "vite.config.mjs"],
  },
  {
    name: "astro",
    clientPrefix: "PUBLIC_",
    envAccess: "import.meta.env",
    configFiles: ["astro.config.mjs", "astro.config.ts"],
  },
  {
    name: "remix",
    clientPrefix: null,
    envAccess: "process.env",
    configFiles: ["remix.config.js", "remix.config.ts"],
  },
  {
    name: "nuxt",
    clientPrefix: "NUXT_PUBLIC_",
    envAccess: "process.env",
    configFiles: ["nuxt.config.ts", "nuxt.config.js"],
  },
  {
    name: "cra",
    clientPrefix: "REACT_APP_",
    envAccess: "process.env",
    configFiles: [],
  },
  {
    name: "expo",
    clientPrefix: "EXPO_PUBLIC_",
    envAccess: "process.env",
    configFiles: ["app.json", "app.config.ts", "app.config.js"],
  },
];

export interface DetectionResult {
  detected: FrameworkInfo[];
  packageJson: Record<string, unknown> | null;
}

export function detectFrameworks(cwd: string): DetectionResult {
  const pkgPath = path.join(cwd, "package.json");
  let packageJson: Record<string, unknown> | null = null;

  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      // malformed package.json
    }
  }

  const deps = mergeDeps(packageJson);
  const detected: FrameworkInfo[] = [];

  for (const fw of FRAMEWORKS) {
    if (matchesByDeps(fw, deps) || matchesByConfig(fw, cwd)) {
      detected.push(fw);
    }
  }

  return { detected, packageJson };
}

function mergeDeps(
  pkg: Record<string, unknown> | null
): Set<string> {
  if (!pkg) return new Set();
  const all = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  return new Set(Object.keys(all));
}

function matchesByDeps(fw: FrameworkInfo, deps: Set<string>): boolean {
  switch (fw.name) {
    case "next":
      return deps.has("next");
    case "vite":
      return deps.has("vite") && !deps.has("astro") && !deps.has("nuxt");
    case "astro":
      return deps.has("astro");
    case "remix":
      return deps.has("@remix-run/node") || deps.has("@remix-run/react");
    case "nuxt":
      return deps.has("nuxt");
    case "cra":
      return deps.has("react-scripts");
    case "expo":
      return deps.has("expo");
    default:
      return false;
  }
}

function matchesByConfig(fw: FrameworkInfo, cwd: string): boolean {
  return fw.configFiles.some((f) => fs.existsSync(path.join(cwd, f)));
}

export function classifyVariable(
  name: string,
  frameworks: FrameworkInfo[]
): "server" | "client" | "unknown" {
  for (const fw of frameworks) {
    if (fw.clientPrefix && name.startsWith(fw.clientPrefix)) {
      return "client";
    }
  }

  const serverHints = [
    "SECRET",
    "PRIVATE",
    "KEY",
    "TOKEN",
    "PASSWORD",
    "DB_",
    "DATABASE_",
    "REDIS_",
    "SMTP_",
    "AWS_",
  ];

  if (serverHints.some((hint) => name.includes(hint))) {
    return "server";
  }

  return "unknown";
}

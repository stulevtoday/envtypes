import fs from "node:fs";
import path from "node:path";

export interface EnvtypesConfig {
  /** Directories/globs to scan */
  include?: string[];
  /** Directories/globs to exclude */
  exclude?: string[];
  /** Output path for generated env module */
  output?: string;
  /** Output path for generated .env.example */
  exampleOutput?: string;
  /** Variables to ignore (won't appear in schema or checks) */
  ignore?: string[];
  /** Override inferred types */
  overrides?: Record<string, {
    type?: "string" | "number" | "boolean" | "url" | "port" | "enum";
    required?: boolean;
    enumValues?: string[];
    description?: string;
  }>;
  /** Security rules configuration */
  security?: {
    /** Disable specific security rules */
    disableRules?: string[];
    /** Additional patterns to treat as secrets */
    secretPatterns?: string[];
  };
}

const CONFIG_FILES = [
  ".envtypes.json",
  ".envtypesrc",
  ".envtypesrc.json",
];

const DEFAULT_CONFIG: Required<EnvtypesConfig> = {
  include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.d.ts",
  ],
  output: "src/env.ts",
  exampleOutput: ".env.example",
  ignore: [],
  overrides: {},
  security: {
    disableRules: [],
    secretPatterns: [],
  },
};

export function loadConfig(cwd: string): EnvtypesConfig {
  for (const filename of CONFIG_FILES) {
    const configPath = path.join(cwd, filename);
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as EnvtypesConfig;
        return mergeConfig(DEFAULT_CONFIG, parsed);
      } catch {
        // malformed config — fall through to defaults
      }
    }
  }

  // Also check package.json "envtypes" field
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.envtypes && typeof pkg.envtypes === "object") {
        return mergeConfig(DEFAULT_CONFIG, pkg.envtypes as EnvtypesConfig);
      }
    } catch {
      // malformed package.json
    }
  }

  return { ...DEFAULT_CONFIG };
}

function mergeConfig(
  defaults: Required<EnvtypesConfig>,
  overrides: EnvtypesConfig
): EnvtypesConfig {
  return {
    include: overrides.include ?? defaults.include,
    exclude: overrides.exclude
      ? [...defaults.exclude, ...overrides.exclude]
      : defaults.exclude,
    output: overrides.output ?? defaults.output,
    exampleOutput: overrides.exampleOutput ?? defaults.exampleOutput,
    ignore: overrides.ignore ?? defaults.ignore,
    overrides: { ...defaults.overrides, ...overrides.overrides },
    security: {
      disableRules: overrides.security?.disableRules ?? defaults.security.disableRules,
      secretPatterns: overrides.security?.secretPatterns
        ? [...(defaults.security.secretPatterns ?? []), ...overrides.security.secretPatterns]
        : defaults.security.secretPatterns,
    },
  };
}

export function generateConfigFile(): string {
  const config = {
    include: DEFAULT_CONFIG.include,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
    ],
    output: "src/env.ts",
    ignore: [],
    overrides: {},
  };
  return JSON.stringify(config, null, 2) + "\n";
}

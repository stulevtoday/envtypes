class Schema<T> {
  private _required = true;
  private _default?: string;
  private _parse: (value: string) => T;

  constructor(parse: (value: string) => T) {
    this._parse = parse;
  }

  optional(): Schema<T | undefined> {
    this._required = false;
    return this as Schema<T | undefined>;
  }

  default(value: string): Schema<T> {
    this._default = value;
    return this;
  }

  /** @internal */
  resolve(value: string | undefined): T {
    if (value === undefined || value === "") {
      if (this._default !== undefined) {
        return this._parse(this._default);
      }
      if (!this._required) {
        return undefined as T;
      }
      throw new Error("Required but not provided");
    }
    return this._parse(value);
  }
}

export const t = {
  string(): Schema<string> {
    return new Schema((v) => v);
  },

  number(): Schema<number> {
    return new Schema((v) => {
      const n = Number(v);
      if (isNaN(n)) throw new Error(`Expected number, got "${v}"`);
      return n;
    });
  },

  boolean(): Schema<boolean> {
    return new Schema((v) => {
      const lower = v.toLowerCase();
      if (["true", "1", "yes"].includes(lower)) return true;
      if (["false", "0", "no"].includes(lower)) return false;
      throw new Error(`Expected boolean, got "${v}"`);
    });
  },

  port(): Schema<number> {
    return new Schema((v) => {
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > 65535 || !Number.isInteger(n)) {
        throw new Error(`Expected port (0-65535), got "${v}"`);
      }
      return n;
    });
  },

  url(): Schema<string> {
    return new Schema((v) => {
      try {
        new URL(v);
        return v;
      } catch {
        throw new Error(`Expected valid URL, got "${v}"`);
      }
    });
  },

  enum<T extends string>(values: readonly T[]): Schema<T> {
    return new Schema((v) => {
      if (!values.includes(v as T)) {
        throw new Error(`Expected one of [${values.join(", ")}], got "${v}"`);
      }
      return v as T;
    });
  },
};

type InferSchema<T extends Record<string, Schema<any>>> = {
  [K in keyof T]: T[K] extends Schema<infer U> ? U : never;
};

export function defineEnv<T extends Record<string, Schema<any>>>(
  schema: T
): InferSchema<T> {
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, validator] of Object.entries(schema)) {
    try {
      result[key] = validator.resolve(process.env[key]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${key}: ${msg}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  return result as InferSchema<T>;
}

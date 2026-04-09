export { defineEnv, t } from "./runtime.js";
export { scan } from "./scanner.js";
export type { ScanOptions } from "./scanner.js";
export { generateSchema, schemaToTypenvFile, inferType } from "./schema.js";
export { validate, parseEnvFile, findEnvFiles } from "./validator.js";
export { generateEnvModule, generateEnvExample } from "./generator.js";
export { detectFrameworks, classifyVariable } from "./frameworks.js";
export type { FrameworkInfo, DetectionResult } from "./frameworks.js";
export type {
  EnvVarUsage,
  EnvVarSchema,
  EnvScope,
  InferredType,
  ScanResult,
  ValidationError,
  ValidationResult,
} from "./types.js";

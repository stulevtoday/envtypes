export interface EnvVarUsage {
  name: string;
  filePath: string;
  line: number;
  column: number;
  accessPattern: "dot" | "bracket" | "destructure";
  hasDefault: boolean;
  defaultValue?: string;
}

export type InferredType = "string" | "number" | "boolean" | "url" | "port" | "enum";

export interface EnvVarSchema {
  name: string;
  type: InferredType;
  required: boolean;
  defaultValue?: string;
  description?: string;
  enumValues?: string[];
}

export interface ScanResult {
  variables: EnvVarUsage[];
  files: string[];
  duration: number;
}

export interface ValidationError {
  variable: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  missing: string[];
  extra: string[];
  typeErrors: string[];
}

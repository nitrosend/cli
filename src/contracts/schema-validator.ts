interface SchemaObject {
  const?: unknown;
  enum?: unknown[];
  type?: string | string[];
  required?: string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  additionalProperties?: boolean;
}

export function assertValidSchema(schema: unknown, value: unknown, subject = "value"): void {
  const errors = validateSchema(schema, value);
  if (errors.length > 0) {
    throw new Error(`${subject} does not match schema:\n${errors.join("\n")}`);
  }
}

export function validateSchema(schema: unknown, value: unknown, path = "$"): string[] {
  if (!isRecord(schema)) return [];

  const schemaObject = schema as SchemaObject;
  const errors: string[] = [];

  if ("const" in schemaObject && !sameJsonValue(value, schemaObject.const)) {
    errors.push(`${path} must equal ${formatValue(schemaObject.const)}`);
  }

  if (schemaObject.enum && !schemaObject.enum.some((candidate) => sameJsonValue(value, candidate))) {
    errors.push(`${path} must be one of ${schemaObject.enum.map(formatValue).join(", ")}`);
  }

  if (schemaObject.type && !matchesType(value, schemaObject.type)) {
    errors.push(`${path} must be ${Array.isArray(schemaObject.type) ? schemaObject.type.join(" or ") : schemaObject.type}`);
    return errors;
  }

  if (schemaObject.required) {
    if (!isRecord(value)) {
      errors.push(`${path} must be an object with required fields`);
    } else {
      for (const key of schemaObject.required) {
        if (!(key in value) || value[key] === undefined) errors.push(`${path}.${key} is required`);
      }
    }
  }

  if (schemaObject.properties && isRecord(value)) {
    for (const [key, propertySchema] of Object.entries(schemaObject.properties)) {
      if (key in value && value[key] !== undefined) {
        errors.push(...validateSchema(propertySchema, value[key], `${path}.${key}`));
      }
    }

    if (schemaObject.additionalProperties === false) {
      const knownProperties = new Set(Object.keys(schemaObject.properties));
      for (const key of Object.keys(value)) {
        if (!knownProperties.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (schemaObject.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validateSchema(schemaObject.items, item, `${path}[${index}]`));
    });
  }

  return errors;
}

function matchesType(value: unknown, type: string | string[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    if (candidate === "array") return Array.isArray(value);
    if (candidate === "object") return isRecord(value);
    if (candidate === "integer") return Number.isInteger(value);
    if (candidate === "number") return typeof value === "number" && Number.isFinite(value);
    if (candidate === "null") return value === null;
    return typeof value === candidate;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

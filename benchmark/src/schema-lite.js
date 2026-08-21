// A minimal JSON Schema (2020-12 subset) validator, hand-written to avoid an
// external dependency. It supports exactly the constructs used by
// `contracts/run.schema.json` and `contracts/report.schema.json`:
// type (including nullable unions), enum, const, required, properties,
// additionalProperties, items, minItems, minLength, minimum, maximum,
// pattern, format ("date-time", checked leniently), oneOf, and $ref
// resolution against a document-local `$defs` map.
//
// This is intentionally not a general-purpose validator: it does not
// support every JSON Schema keyword, only the ones the committed contracts
// actually use. If a contract adds an unsupported keyword, this module
// should be extended rather than swapped for a dependency, per the "no
// unnecessary dependencies" constraint on this package.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (type === "number") {
    return typeof value === "number";
  }
  return typeOf(value) === type;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported $ref target: ${ref}`);
  }
  const segments = ref.slice(2).split("/");
  let node = root;
  for (const segment of segments) {
    node = node?.[segment];
  }
  if (node === undefined) {
    throw new Error(`Could not resolve $ref: ${ref}`);
  }
  return node;
}

function validateNode(schema, value, root, path, errors) {
  if (schema.$ref) {
    validateNode(resolveRef(schema.$ref, root), value, root, path, errors);
    return;
  }

  if (schema.oneOf) {
    const subResults = schema.oneOf.map((sub) => {
      const subErrors = [];
      validateNode(sub, value, root, path, subErrors);
      return subErrors;
    });
    const matchCount = subResults.filter((e) => e.length === 0).length;
    if (matchCount !== 1) {
      errors.push(`${path}: expected exactly one oneOf branch to match, ${matchCount} matched`);
    }
    return;
  }

  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      validateNode(subSchema, value, root, path, errors);
    }
  }

  if (schema.not) {
    const notErrors = [];
    validateNode(schema.not, value, root, path, notErrors);
    if (notErrors.length === 0) {
      errors.push(`${path}: matched a forbidden "not" schema`);
    }
  }

  if (schema.if) {
    const conditionErrors = [];
    validateNode(schema.if, value, root, path, conditionErrors);
    if (conditionErrors.length === 0 && schema.then) {
      validateNode(schema.then, value, root, path, errors);
    } else if (conditionErrors.length > 0 && schema.else) {
      validateNode(schema.else, value, root, path, errors);
    }
  }

  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }
    return;
  }

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    }
    return;
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected type ${allowedTypes.join("|")}, got ${typeOf(value)}`);
      return;
    }
  }

  if (value === null) return; // nullable union already satisfied above.

  if (schema.type === "string" || typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: not a valid date-time`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: array shorter than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateNode(schema.items, item, root, `${path}[${index}]`, errors);
      });
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        errors.push(`${path}: array items must be unique`);
      }
    }
    return;
  }

  if (value && typeof value === "object") {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          validateNode(subSchema, value[key], root, `${path}.${key}`, errors);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected additional property "${key}"`);
        }
      }
    }
  }
}

/**
 * Validate `value` against a JSON Schema document. Returns { valid, errors }.
 */
export function validateAgainstSchema(schema, value) {
  const errors = [];
  validateNode(schema, value, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}

export function assertValidAgainstSchema(schema, value, label = "value") {
  const { valid, errors } = validateAgainstSchema(schema, value);
  if (!valid) {
    throw new Error(`${label} failed schema validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

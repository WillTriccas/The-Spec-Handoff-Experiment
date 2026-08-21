const COMMAND_KEYS = new Set(['executable', 'arguments', 'allowedExitCodes']);

export function validateModernizationAdapter(adapter) {
  const errors = validateObject(adapter, 'adapter', [
    'schemaVersion',
    'workingDirectory',
    'build',
    'test',
    'run',
    'outputs'
  ]);

  if (adapter?.schemaVersion !== '1.0.0') {
    errors.push('schemaVersion must be 1.0.0');
  }
  if (!isNonEmptyString(adapter?.workingDirectory)) {
    errors.push('workingDirectory must be a non-empty string');
  }
  for (const name of ['build', 'test', 'run']) {
    errors.push(...validateCommand(adapter?.[name], name));
  }
  if (!Array.isArray(adapter?.outputs) || adapter.outputs.length === 0) {
    errors.push('outputs must be a non-empty array');
  } else {
    const seen = new Set();
    for (const [index, output] of adapter.outputs.entries()) {
      if (!isNonEmptyString(output)) {
        errors.push(`outputs[${index}] must be a non-empty string`);
      }
      if (seen.has(output)) {
        errors.push(`outputs contains duplicate value: ${output}`);
      }
      seen.add(output);
    }
  }

  return errors;
}

export function validateAuditAdapter(adapter) {
  const errors = validateObject(adapter, 'adapter', [
    'schemaVersion',
    'workingDirectory',
    'initialize',
    'propose',
    'decide',
    'export'
  ]);

  if (adapter?.schemaVersion !== '1.0.0') {
    errors.push('schemaVersion must be 1.0.0');
  }
  if (!isNonEmptyString(adapter?.workingDirectory)) {
    errors.push('workingDirectory must be a non-empty string');
  }
  for (const name of ['initialize', 'propose', 'decide', 'export']) {
    errors.push(...validateCommand(adapter?.[name], name));
  }

  return errors;
}

function validateObject(value, label, allowedKeys) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label} must be an object`];
  }

  for (const key of allowedKeys) {
    if (!(key in value)) {
      errors.push(`${label}.${key} is required`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${label}.${key} is not allowed`);
    }
  }

  return errors;
}

function validateCommand(command, label) {
  const errors = validateObject(command, label, [...COMMAND_KEYS]);
  if (errors.length > 0) {
    return errors;
  }

  if (!isNonEmptyString(command.executable)) {
    errors.push(`${label}.executable must be a non-empty string`);
  }
  if (!Array.isArray(command.arguments) || !command.arguments.every((argument) => typeof argument === 'string')) {
    errors.push(`${label}.arguments must be an array of strings`);
  }
  if (!Array.isArray(command.allowedExitCodes) || command.allowedExitCodes.length === 0) {
    errors.push(`${label}.allowedExitCodes must be a non-empty array`);
  } else {
    const seen = new Set();
    for (const code of command.allowedExitCodes) {
      if (!Number.isInteger(code) || code < 0) {
        errors.push(`${label}.allowedExitCodes entries must be non-negative integers`);
      }
      if (seen.has(code)) {
        errors.push(`${label}.allowedExitCodes contains duplicate value: ${code}`);
      }
      seen.add(code);
    }
  }

  return errors;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

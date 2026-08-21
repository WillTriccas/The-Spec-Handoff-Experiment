export function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortDeep(value[key]);
        return result;
      }, {});
  }

  return value;
}

export function stringifyDeterministic(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

export function tryParseJson(text) {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstJsonLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('{') || line.startsWith('['));
    if (!firstJsonLine) {
      return null;
    }

    try {
      return JSON.parse(firstJsonLine);
    } catch {
      return null;
    }
  }
}

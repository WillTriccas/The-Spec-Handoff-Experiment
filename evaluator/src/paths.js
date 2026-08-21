import fs from 'node:fs/promises';
import path from 'node:path';

export function resolveExistingDirectory(inputPath, label) {
  const resolved = path.resolve(inputPath);
  return fs.stat(resolved).then((stat) => {
    if (!stat.isDirectory()) {
      throw new Error(`${label} is not a directory: ${inputPath}`);
    }
    return resolved;
  });
}

export function resolveInside(baseDirectory, requestedPath, label) {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  const resolved = path.resolve(baseDirectory, requestedPath);
  const relative = path.relative(baseDirectory, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }

  throw new Error(`${label} escapes the candidate directory: ${requestedPath}`);
}

export function toPosixRelative(baseDirectory, filePath) {
  return path.relative(baseDirectory, filePath).split(path.sep).join('/');
}

export function hasPathSeparator(value) {
  return value.includes('/') || value.includes('\\');
}

export async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

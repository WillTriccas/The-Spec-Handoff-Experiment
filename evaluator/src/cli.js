import fs from 'node:fs/promises';
import path from 'node:path';
import { EPISODES } from './constants.js';
import { evaluateAuditFeature } from './audit.js';
import { evaluateModernization } from './modernization.js';
import { fixtureHashes } from './fixtures.js';
import { stringifyDeterministic } from './json.js';
import { ensureParentDirectory, resolveExistingDirectory } from './paths.js';

export async function main(argv) {
  const [subcommand = 'evaluate', ...rest] = argv;
  if (subcommand === 'fixture-hashes') {
    process.stdout.write(stringifyDeterministic(fixtureHashes()));
    return;
  }

  if (subcommand !== 'evaluate') {
    throw new Error(`Unknown subcommand: ${subcommand}`);
  }

  const args = parseArgs(rest);
  const candidate = required(args, 'candidate');
  const episode = required(args, 'episode');
  const evidencePath = required(args, 'evidence');
  const dotnetPath = args.dotnet ? path.resolve(args.dotnet) : undefined;

  if (!Object.values(EPISODES).includes(episode)) {
    throw new Error(`Unsupported episode: ${episode}`);
  }

  const candidateRoot = await resolveExistingDirectory(candidate, 'candidate');
  const evidence = episode === EPISODES.modernization
    ? await evaluateModernization(candidateRoot, { dotnetPath })
    : await evaluateAuditFeature(candidateRoot, { dotnetPath });

  const resolvedEvidencePath = path.resolve(evidencePath);
  await ensureParentDirectory(resolvedEvidencePath);
  await fs.writeFile(resolvedEvidencePath, stringifyDeterministic(evidence));
  process.stdout.write(stringifyDeterministic({
    episodeId: evidence.episodeId,
    evidencePath: resolvedEvidencePath,
    outcome: evidence.outcome,
    score: evidence.score
  }));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

function required(args, key) {
  if (!args[key]) {
    throw new Error(`Missing required --${key}`);
  }
  return args[key];
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRemoteSourceProvenance } from "./lib/source-provenance.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = verifyRemoteSourceProvenance({
  provenancePath: path.join(repoRoot, "provenance", "baselines.json")
});
console.log(JSON.stringify(result, null, 2));

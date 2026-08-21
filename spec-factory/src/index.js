export const specContractVersion = "1.0.0";

export { STAGES, STAGE_IDS, stageById } from "./stages.js";
export { loadBundle, bundleStagePath, writeStage, assembleSpec, renderSpecMarkdown } from "./bundle.js";
export { validateBundle, isApprovable } from "./validate.js";
export { scoreBundle, SPEC_SCORING_WEIGHTS } from "./scoring.js";
export { hashBundle, hashText, canonicalize } from "./hashing.js";


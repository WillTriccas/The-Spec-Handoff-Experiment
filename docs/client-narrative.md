# Client narrative

The experiment asks a narrow, commercially relevant question: when a strong
model authors a high-quality specification once, can a faster implementation
model execute that exact handoff with equivalent quality and fewer tokens?

The design avoids comparing different specifications or raw prompts. Opus authors
both episode specs while blind to the evaluator; then Opus and MAI each implement
the same frozen artifact three times. This isolates implementation-model choice
more cleanly than a four-lane raw-versus-spec demonstration.

The headline is intentionally conservative:

- both Financial Services episodes must support it;
- every MAI comparison run must pass all applicable gates;
- failed or timed-out work is retained as zero, not discarded;
- tokens, not speculative dollar pricing, are the primary consumption proxy;
- authoring effort remains visible in a separate amortized end-to-end view.

The repository currently demonstrates only protocol readiness. It makes no claim
about either model's measured quality, speed, token use, or cost.

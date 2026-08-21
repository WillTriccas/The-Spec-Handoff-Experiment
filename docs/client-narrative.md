# Client narrative

The experiment asks a narrow, commercially relevant question: can an efficient
model executing a structured handoff outperform the end-to-end direct execution
of a frontier model?

Opus authors each handoff using GitHub Spec Kit while blind to the evaluator.
MAI implements that frozen artifact three times. The control is three fresh Opus
sessions tackling only the original task brief and baseline, with no spec.

The headline is intentionally conservative:

- both Financial Services episodes must support it;
- every MAI comparison run must pass all applicable gates;
- failed or cancelled work is retained as zero, not discarded;
- no timeout truncates either model;
- tokens, not speculative dollar pricing, are the primary consumption proxy;
- productive execution time and quality are equally visible primary measures;
- authoring effort remains visible in an amortized end-to-end view.

The repository currently demonstrates only protocol readiness. It makes no claim
about either model's measured quality, speed, token use, or cost.

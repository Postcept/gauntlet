# @postcept/gauntlet

```
npx @postcept/gauntlet
```

Runs 15 reproducible broken-refund scenarios (timeouts, duplicates, pending
settlements, wrong amount, currency, or customer, terminal failures, provider
drift, uncorrelatable claims) through Postcept's verification engine over the
public playground endpoint, and through two baselines, then scores each against a
fixed, public ground truth.

## What's compared

`trust-the-agent` believes the agent's "done" claim. With no verification it
scores every scenario as safe, so it is right only on the ones that really are
complete.

`source-reread` re-reads the system of record and treats an existing record in a
success state as done. This is the simple status re-check teams write by hand. It
has no notion of duplicates, wrong amount or customer, pending versus final, or
unknown provider states, so it over-claims on exactly those.

`always-block` never trusts anything. On a trap-heavy set this policy would
score high while blocking every legitimate completion, which is exactly why the
set is balanced and the error types are split.

`postcept` is the `safe_to_claim_complete` decision from the engine.

A system scores a point when its safe or not-safe answer matches the scenario's
ground truth, which is set in `scenarios.json`. The set is balanced on purpose:
seven of the twenty-one scenarios are genuinely safe to call complete and
fourteen are traps, and the two ways to be wrong are reported separately. A
false safe tells a customer "done" when it is not. A false block holds a
completion that was real. `trust-the-agent` maximizes false safes,
`always-block` maximizes false blocks, and both are printed in every run so
neither degenerate policy can look good.

## Why the comparison is fair

Ground truth is fixed and public in `scenarios.json` before any run. The
baselines run against the same ledger Postcept sees, so they are reference
implementations of common practice rather than strawmen. Postcept's column is the
engine over the public API, not a hard-coded result.

## Limitations

The scenarios are synthetic and deterministic. They exercise the verification
logic, not real provider flakiness, latency, or the full range of Stripe states.
`source-reread` is a deliberately simple baseline. A team could write a deeper
checker, at which point they have started building what Postcept does. A perfect
Postcept score here means the engine classifies these scenarios correctly, not
that it is infallible on every real case.

`--json` emits machine-readable results for a CI gate.

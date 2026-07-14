#!/usr/bin/env node
// Scores each scenario through Postcept's verification engine (the public
// playground endpoint) and through two baselines that stand in for how teams
// check completion today:
//
//   trust-the-agent : believe the agent's "done" claim.
//   source-reread   : re-read the system of record and treat an existing record
//                     as done.
//
// A system scores a point when its "safe to tell the customer?" answer matches
// the scenario's ground truth. The baselines run against the same ledger Postcept
// sees, and the ground truth is fixed in scenarios.json, so the comparison is not
// rigged. Their limits are in README.md.
//
//   npx @postcept/gauntlet          run and print a scorecard
//   npx @postcept/gauntlet --json   machine-readable results

import { readFileSync } from "node:fs";

const API_URL = (process.env.POSTCEPT_API_URL || "https://api.postcept.com").replace(/\/$/, "");

interface ScenarioSpec {
  id: string;
  expect_safe: boolean;
  note: string;
}

interface LedgerRecord {
  refund_id?: string;
  charge_id?: string;
  amount_cents?: number;
  currency?: string | null;
  status?: string;
}

interface PlaygroundRun {
  claim: { refund_id?: string | null; amount_cents?: number; currency?: string };
  source_of_truth: LedgerRecord[];
  verification: { safe_to_claim_complete?: boolean } | null;
  unreachable: string | null;
}

type System =
  | "trust-the-agent"
  | "always-block"
  | "source-reread"
  | "bespoke-checker"
  | "postcept";

// Baseline 1: no verification. The agent said done, so treat it as done.
function trustTheAgent(): boolean {
  return true;
}

// Baseline 2: never trust anything. On an unbalanced trap set this scores high
// while blocking every legitimate completion, which is why the set is balanced
// and why false-block is reported separately from false-safe.
function alwaysBlock(): boolean {
  return false;
}

// Baseline 4: a competent hand-rolled checker, the strong version of what a team
// builds in a sprint: re-read the record, compare status, amount and currency,
// and flag any second refund on the same charge as a duplicate. It catches most
// traps. What it cannot do is correlate: it blocks legitimate second operations
// and case-different currencies, and it never checks the customer.
function bespokeChecker(run: PlaygroundRun): boolean {
  if (run.unreachable) return false;
  const claim = run.claim;
  const rec = run.source_of_truth.find((r) => r.refund_id === claim.refund_id);
  if (!rec) return false;
  if (rec.status !== "succeeded") return false;
  if (rec.amount_cents !== claim.amount_cents) return false;
  if (rec.currency !== claim.currency) return false;
  const siblings = run.source_of_truth.filter(
    (r) => r.charge_id === rec.charge_id && r.refund_id !== rec.refund_id
  );
  return siblings.length === 0;
}

// Baseline 3: re-read the source and call it done if a record exists in a
// success state. This is the simple status re-check teams write by hand. It has
// no notion of duplicates, wrong amount or customer, or unknown states, which is
// what the gauntlet shows.
function sourceReread(run: PlaygroundRun): boolean {
  if (run.unreachable) return true; // a naive re-check assumes the earlier success held
  const rec = run.source_of_truth[0];
  return rec?.status === "succeeded";
}

async function runScenario(spec: ScenarioSpec): Promise<Record<System, boolean> | null> {
  const res = await fetch(`${API_URL}/v1/playground/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: spec.id }),
  });
  if (!res.ok) return null;
  const run = (await res.json()) as PlaygroundRun;
  return {
    "trust-the-agent": trustTheAgent(),
    "always-block": alwaysBlock(),
    "source-reread": sourceReread(run),
    "bespoke-checker": bespokeChecker(run),
    postcept: run.verification?.safe_to_claim_complete ?? false,
  };
}

function loadScenarios(): ScenarioSpec[] {
  const path = new URL("../scenarios.json", import.meta.url);
  return (JSON.parse(readFileSync(path, "utf8")) as { scenarios: ScenarioSpec[] }).scenarios;
}

async function main(): Promise<void> {
  const scenarios = loadScenarios();
  const systems: System[] = [
    "trust-the-agent",
    "always-block",
    "source-reread",
    "bespoke-checker",
    "postcept",
  ];
  const scores: Record<System, number> = {
    "trust-the-agent": 0,
    "always-block": 0,
    "source-reread": 0,
    "bespoke-checker": 0,
    postcept: 0,
  };
  // The two ways to be wrong, reported separately: a false safe tells a customer
  // "done" when it is not, a false block holds a completion that was real.
  const falseSafe: Record<System, number> = {
    "trust-the-agent": 0,
    "always-block": 0,
    "source-reread": 0,
    "bespoke-checker": 0,
    postcept: 0,
  };
  const falseBlock: Record<System, number> = {
    "trust-the-agent": 0,
    "always-block": 0,
    "source-reread": 0,
    "bespoke-checker": 0,
    postcept: 0,
  };
  const rows: { id: string; expect: boolean; got: Record<System, boolean> }[] = [];

  for (const spec of scenarios) {
    const got = await runScenario(spec);
    if (!got) {
      console.error(`Could not reach the playground at ${API_URL}. Try again in a few seconds.`);
      process.exit(1);
    }
    for (const sys of systems) {
      // Correct = the system's safe/not-safe answer matches ground truth.
      if (got[sys] === spec.expect_safe) scores[sys] += 1;
      else if (got[sys]) falseSafe[sys] += 1;
      else falseBlock[sys] += 1;
    }
    rows.push({ id: spec.id, expect: spec.expect_safe, got });
  }

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { total: scenarios.length, scores, false_safe: falseSafe, false_block: falseBlock, rows },
        null,
        2
      )
    );
    return;
  }

  const n = scenarios.length;
  console.log(`\nCompletion Gap Gauntlet, ${n} scenarios scored against ground truth\n`);
  const pad = (s: string, w: number) => s.padEnd(w);
  console.log(pad("scenario", 22) + pad("truth", 8) + systems.map((s) => pad(s, 18)).join(""));
  console.log("-".repeat(22 + 8 + 18 * systems.length));
  for (const r of rows) {
    const truth = r.expect ? "safe" : "not-safe";
    const cells = systems
      .map((s) => pad((r.got[s] === r.expect ? "✓ " : "✗ ") + (r.got[s] ? "safe" : "not-safe"), 18))
      .join("");
    console.log(pad(r.id, 22) + pad(truth, 8) + cells);
  }
  console.log("-".repeat(22 + 8 + 18 * systems.length));
  console.log(pad("SCORE", 22) + pad("", 8) + systems.map((s) => pad(`${scores[s]}/${n}`, 18)).join(""));
  console.log(
    pad("false safe", 22) + pad("", 8) + systems.map((s) => pad(String(falseSafe[s]), 18)).join("")
  );
  console.log(
    pad("false block", 22) + pad("", 8) + systems.map((s) => pad(String(falseBlock[s]), 18)).join("")
  );
  console.log(
    "\nGround truth and scenario limitations: scenarios.json + README.md. " +
      "Postcept's column is the real engine via the public playground. Baselines " +
      "run against the same synthetic ledger. No comparison is rigged.\n"
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

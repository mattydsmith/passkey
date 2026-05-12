# Parity Test Suite

Language-agnostic conformance tests for [`spec/protocol.md`](../../spec/protocol.md).

Vectors are JSON files describing scenarios — sequenced HTTP requests with
captured variables, expected response shape, and expected error codes. The
Node-based runner executes them against any HTTP server that implements the
spec. The TypeScript server in `examples/hono-app` is the reference target;
any future second implementation is test-driven against the same vectors.

## Layout

```
tests/parity/
├── README.md                # this file
├── runner/                  # Node CLI (not part of the pnpm workspace)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/                 # runner source
│   └── tests/               # runner self-tests (vitest)
└── vectors/                 # JSON scenario files (added in later tasks)
```

## Prerequisites

The runner lives outside the pnpm workspace so its dependencies don't hoist
into the main install graph. Install once:

```bash
cd tests/parity/runner
pnpm install
pnpm exec playwright install chromium
```

## Running

From the repository root:

```bash
pnpm test:parity
```

That `cd`s into `tests/parity/runner` and runs the runner's own test command
(currently just `vitest run` against the runner's self-tests; once the full
CLI lands it will boot `examples/hono-app` and execute every vector).

## Authoring a vector

Vector authoring conventions (file layout, matcher reference, the WebAuthn
ceremony placeholder) are documented in this file as the suite grows. See
the implementation plan for the current state:
[`docs/superpowers/plans/2026-05-12-protocol-parity-vectors.md`](../../docs/superpowers/plans/2026-05-12-protocol-parity-vectors.md).

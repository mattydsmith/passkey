# Host-owned email start — local SDK evidence

The optional Go/TypeScript email-start hooks let the host own the complete
eligibility, reservation, delivery and activation sequence. Default SDK
sending and storage are skipped when the hook is configured, even on error.
The configured public lifetime stays constant; empty IDs fail closed.
Transport metadata is supplied without claiming any forwarded header or
Fetch request has a trusted peer identity. TypeScript HTTP now trims before
validation, matching Go's existing behavior. Other default start behavior
is unchanged, including its lack of host abuse/eligibility policy.

The Go mounted-route test was run after declaring the optional config but
before wiring it: success/error/empty/whitespace each returned 200, hook=0,
legacy writes=1 and sends=1. The corrected routes pass callback-input,
no-fallback, malformed-input, incomplete-result and no-cookie checks in both
implementations. Direct TypeScript calls do not invent transport metadata.

Public transaction helpers invalidate older codes or insert a fresh hashed
code within the host's existing transaction. Go and TypeScript tests join
these operations to a host marker, then exercise explicit rollback, deferred
foreign-key COMMIT failure and success. Old-code invalidation and new-code
insertion roll back together; calls without a transaction are refused.

Local validation: Go race httpapi 11.656s and storage 1.784s; after adding
older-code invalidation, focused storage race 1.355s. Node 22 (matching CI)
workspace build, core/Hono/client tests and workspace typecheck all passed,
including the final helper export/invalidation changes. CI still supplies
cross-implementation parity. The host's full A02 limits, normalization policy,
enumeration timings, trusted proxy admission, mail delivery and concurrency
workloads are separate Slate work (#2717), not proven by these SDK hooks.
No npm publication or deployment is part of this change.

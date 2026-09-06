# Authentication storage safety implementation

1. Add Go regressions and capture baseline failures.
2. Add atomic OTP storage verification, bounded connection lock waits and clock
   sampling inside the transaction. Update Go auth and HTTP sign-out error handling.
3. Make TypeScript OTP check/update atomic across database connections while
   retaining error semantics and propagating failed revocation.
4. Run scoped race, peer tests and HTTP parity; review rollback/error boundaries.
5. Commit the reviewed change and preserve a verified recovery bundle. Publishing
   this separate SDK repository requires Matt's explicit push authorization under
   its CLAUDE.md; prepare the exact diff and results first.

# Hono Example

Runs a local Passkey SDK server on port 3000 using SQLite (`./app.db`).

## First run

```bash
pnpm install
pnpm migrate
pnpm dev
```

OTP codes are printed to the console. Try:

```bash
curl -s -X POST http://localhost:3000/auth/email/start \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'

# Read the code from the server console, then:
curl -s -X POST http://localhost:3000/auth/email/verify \
  -H 'content-type: application/json' \
  -d '{"otpId":"otp_...","code":"123456"}'
```

# Big-2-Backend

## LLM-powered AI configuration

The backend supports an LLM-driven strategy that delegates move selection to
OpenRouter. To enable it, define the following environment
variables before starting the server:

| Variable | Description |
| --- | --- |
| `OPENROUTER_API_KEY` | Required. API key issued by [openrouter.ai](https://openrouter.ai). |
| `OPENROUTER_MODEL` | Optional. Initial default model (runtime default is `x-ai/grok-4-fast`). |
| `OPENROUTER_SITE_URL` | Optional but recommended. URL identifying the calling site for OpenRouter telemetry. |
| `OPENROUTER_APP_NAME` | Optional. Human-readable application name sent to OpenRouter. |

If the API key is missing or an OpenRouter request fails, the server
automatically falls back to the built-in standard AI strategy so games can
continue uninterrupted.

## Admin panel (no DB)

The backend now exposes admin APIs at `/admin/api/*`, and the frontend panel is
available at `/admin`.

Set one of these environment variables to enable login:

| Variable | Description |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | Preferred. bcrypt hash of your password. |
| `ADMIN_PASSWORD` | Fallback plaintext password (less secure). |

Generate a bcrypt hash locally:

```bash
node -e "import bcrypt from 'bcryptjs'; bcrypt.hash(process.argv[1], 12).then(console.log)" "your-password-here"
```

## Environment files

Use these files:

- `backend/.env` for your local values
- `backend/.env.example` as the shared template

For frontend local API target:

- `frontend/.env` for local values
- `frontend/.env.example` as the shared template

`frontend/src/config.js` reads `VITE_API_BASE_URL` and falls back to the
current hardcoded defaults if it is not set.

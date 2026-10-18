# Railway template for the web connector (maintainer notes)

The "Deploy on Railway" button in the main README points at a Railway template. Railway only lets you create templates in its dashboard, so this is a one-time manual step. Once it exists, replace `TEMPLATE_CODE` in the README button with the template's code.

## Create the template

1. In Railway, open Workspace settings > Templates > New Template.
2. Add a service from the GitHub repository `https://github.com/jkatz015/uww-student-plugins` (branch `main`). Name the service `canvas-connector`.
3. Settings tab:
   - Start command: leave empty. Railway runs `npm start` from the root `package.json`, which starts the server in web mode.
   - Healthcheck path: `/health`
   - Public networking: enable HTTP, so each copy gets a `*.up.railway.app` address.
4. Variables tab:

| Variable | Value | Notes |
| --- | --- | --- |
| `CANVAS_TOKEN` | leave empty | Required. The person deploying pastes their own Canvas access token. Add a description so the deploy page explains it. |
| `CANVAS_CONNECTOR_PASSWORD` | `${{secret(32, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")}}` | Generated per deploy. This is the owner's sign-in password. Letters and digits only, so it copies cleanly. |
| `CANVAS_URL` | `https://uwwtw.instructure.com` | UW-Whitewater Canvas. |
| `CANVAS_TZ` | `America/Chicago` | Time zone for due dates. |

5. Click Create Template, copy the template code from its URL (`railway.com/new/template/<code>`), and put it in the README button.

Publishing the template to Railway's public marketplace is optional. An unpublished template still works for anyone who has the link.

## How the server behaves in web mode

- Started by `npm start` (`node plugins/uww-canvas/server/server.js --web`). The desktop plugin never runs this and never loads `server/web.js`.
- Refuses to start, with a clear message in Deploy Logs, if `CANVAS_CONNECTOR_PASSWORD` is missing or under 16 characters, or if `CANVAS_TOKEN` or `CANVAS_URL` is missing.
- Uses the domain each request arrived on as its public address, so the `*.up.railway.app` address and any custom domain both work. `PUBLIC_URL` pins one address if ever needed.
- The sign-in key is derived from the password with scrypt at startup, so nothing the server hands out can be used to guess the password offline. Wrong passwords are limited to 10 per 15 minutes per address.
- Codes and refresh tokens work once, tracked in memory. After a restart or sleep that list is empty, so changing the password is the way to cut off a refresh token you think was copied.
- Read-only tools only. Submitting, posting and downloading files are left out entirely.
- Sign-in is a small single-owner OAuth flow (registration, sign-in page, PKCE, access and refresh tokens). Tokens are signed with a key derived from the password and not stored, so they survive sleep and restarts. Changing the password signs everyone out.
- Safe with Serverless (sleep): nothing runs in the background, so the service sleeps after about 10 minutes idle.

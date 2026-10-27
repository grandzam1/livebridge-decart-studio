# LiveBridge — Decart Live Studio

A small Next.js UI for live camera transformation through Decart, with direct image-reference controls and a separate output-only page for OBS Browser Source.

## Run locally

1. Install Node.js 22+ and pnpm 11.25.0.
2. Copy `.env.example` to `.env.local` and set `APP_ORIGINS=http://localhost:3000` plus the key for your provider (see below).
3. Run `pnpm install`, then `pnpm dev`.
4. Open `http://localhost:3000`, allow camera access, choose a live mode, optionally add a reference image, and click **Start live**.

### Live providers

| `LIVE_PROVIDER` | Required key | Studio preview | OBS Browser Source |
| --- | --- | --- | --- |
| `decart` (default) | `DECART_API_KEY` | Yes (`@decartai/sdk`) | Yes |
| `fal` | `FAL_KEY` | Yes (Lucy via `@fal-ai/client`) | Not yet |

To use FAL Lucy without touching Decart credentials: set `LIVE_PROVIDER=fal`, set `FAL_KEY` from the [fal dashboard](https://fal.ai/dashboard/keys), keep `APP_ORIGINS`, and restart the server. Switch back with `LIVE_PROVIDER=decart` (or omit it).

On FAL, Character/Restyle use `decart/lucy-2-5/realtime` and Try-on uses `decart/lucy2-vton/realtime`. Built-in prompts are sent per mode; your reference image maps to `reference_image_url`. The permanent `FAL_KEY` stays server-side; the browser only receives short-lived realtime JWTs from `/api/fal/realtime-token`.

`APP_ORIGINS` is a comma-separated allowlist of exact origins (`scheme://host[:port]`, no path or trailing slash). Add each trusted browser origin explicitly. The server checks the request's `Origin` header against this fixed configuration and does not trust client-supplied forwarded-host/protocol headers. The initial studio remains available when server settings are missing, shows the missing variable names, and disables live start until setup is complete.

Camera access requires a secure browser context: `localhost` is allowed for local development; a remote deployment should use HTTPS.

## Image reference

Choose a supported image to preview it locally. It is included when a new live session starts. During an active session, selecting or replacing an image does not send it automatically; press **Apply to live** to update the live look. Clearing the selection also clears the active reference. The permanent API key stays server-side; the browser receives only short-lived, model- and origin-scoped client tokens.

## OBS output

With `OBS_KEY=zam`, the OBS link is `http://localhost:3000/obs?key=zam`. Add that URL once as an OBS Browser Source at the canvas size. The page stays blank until you press **Start live**, then it shows only the AI video. A different key stays blank. Stopping the session makes the page blank again. The current session token is kept in memory for this server process. The URL is a web page for OBS Browser Source, not a raw RTMP/SRT endpoint.

## Scope and security

The UI intentionally has no prompt editor or image/video editing workspace. Reference images guide the selected Decart live mode. Video inference is hosted by Decart; this app does not run Decart models locally.

The server token endpoint limits client tokens to one allowlisted origin and the selected live model. `APP_ORIGINS` is an origin restriction, not user authentication: anyone with access to an unprotected public deployment may still request billable tokens from an allowed origin. Put public deployments behind owner authentication or a private reverse proxy, and apply your own access/rate limits. Never place the permanent key in client code or browser storage.

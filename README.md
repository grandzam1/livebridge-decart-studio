# LiveBridge — Decart Live Studio

A small Next.js UI for live camera transformation through Decart, with direct image-reference controls and a separate output-only page for OBS Browser Source.

## Run locally

1. Install Node.js 22+ and pnpm 11.25.0.
2. Copy `.env.example` to `.env.local` and set the permanent `DECART_API_KEY` plus `APP_ORIGINS=http://localhost:3000`.
3. Run `pnpm install`, then `pnpm dev`.
4. Open `http://localhost:3000`, allow camera access, choose a live mode, optionally add a reference image, and click **Start live**.

`APP_ORIGINS` is a comma-separated allowlist of exact origins (`scheme://host[:port]`, no path or trailing slash). Add each trusted browser origin explicitly. The server checks the request's `Origin` header against this fixed configuration and does not trust client-supplied forwarded-host/protocol headers. The initial studio remains available when server settings are missing, shows the missing variable names, and disables live start until setup is complete.

Camera access requires a secure browser context: `localhost` is allowed for local development; a remote deployment should use HTTPS.

## Image reference

Choose a supported image to preview it locally. It is included when a new live session starts. During an active session, selecting or replacing an image does not send it automatically; press **Apply to live** to update the live look. Clearing the selection also clears the active reference. The permanent API key stays server-side; the browser receives only short-lived, model- and origin-scoped client tokens.

## OBS output

Once the live session is connected, copy the link under **OBS output**. In OBS, add **Sources → Browser**, paste the viewer URL, and set its width and height to match the stream canvas. The URL opens the app's output-only `/obs` viewer. It is a web page for OBS Browser Source, not a raw RTMP/SRT endpoint. Treat the copied URL as a private capability; it stops working when the live session ends.

## Scope and security

The UI intentionally has no prompt editor or image/video editing workspace. Reference images guide the selected Decart live mode. Video inference is hosted by Decart; this app does not run Decart models locally.

The server token endpoint limits client tokens to one allowlisted origin and the selected live model. `APP_ORIGINS` is an origin restriction, not user authentication: anyone with access to an unprotected public deployment may still request billable tokens from an allowed origin. Put public deployments behind owner authentication or a private reverse proxy, and apply your own access/rate limits. Never place the permanent key in client code or browser storage.

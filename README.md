# LiveBridge — Decart Live Studio

A small Next.js UI for live camera transformation through Decart, with direct image-reference controls and a separate output-only page for OBS Browser Source.

## Run locally

1. Install Node.js 22+ and pnpm 11.25.0.
2. Copy `.env.example` to `.env.local` and set `DECART_API_KEY` there. Never place the permanent key in client code or browser storage.
3. Run `pnpm install`, then `pnpm dev`.
4. Open `http://localhost:3000`, allow camera access, choose a live mode, optionally add a reference image, and click **Start live**.

Camera access requires a secure browser context: `localhost` is allowed for local development; a remote deployment should use HTTPS.

## OBS output

Once the live session is connected, copy the link under **OBS output**. In OBS, add **Sources → Browser**, paste the viewer URL, and set its width and height to match the stream canvas. The URL opens the app's output-only `/obs` viewer. It is a web page for OBS Browser Source, not a raw RTMP/SRT endpoint. Treat the copied URL as a private capability; it stops working when the live session ends.

## Scope and security

The UI intentionally has no prompt editor or image/video editing workspace. Reference images guide the selected Decart live mode. Video inference is hosted by Decart; this app does not run Decart models locally.

The server token endpoint checks same-origin requests and limits client tokens to the selected live model and app origin. Because anyone with access to an unprotected public app could request billable tokens, put any public deployment behind owner authentication or a private reverse proxy. The self-hosted deployment must keep the permanent key server-side and impose your own access/rate limits as needed.

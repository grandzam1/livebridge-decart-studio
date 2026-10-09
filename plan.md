# LiveBridge implementation plan

## Product scope

Build a minimal self-hosted Next.js interface over the official Decart JavaScript SDK. The app transforms a browser camera stream through Decart-hosted realtime inference, gives the user direct image-reference controls, and provides a clean OBS Browser Source viewer page for the transformed session. Exclude prompt editing and image/video editing workspaces. The permanent Decart API key stays on the server; the browser receives only short-lived client tokens. The UI must disclose that inference itself runs on Decart, not on the self-hosted machine.

## Implementation approach

- Use Next.js App Router with TypeScript and Node.js server runtime.
- Use Mantine's ready-made AppShell, Paper, Group/Stack, Button, Select, Dropzone, Badge, Alert, Tooltip, CopyButton, AspectRatio and related core components. Use `@tabler/icons-react` for icons. Compose these components into the requested screens rather than inventing replacement controls or a custom component system.
- Integrate `@decartai/sdk` for realtime connect/subscribe. The Studio page acquires the selected camera and optional microphone, shows local and transformed streams, applies a selected reference image only at session start or after the user presses Apply, tracks connection state/usage, and stops camera tracks on stop, terminal disconnect, session end, connection failure, and teardown. Invalidate in-flight startup attempts on unmount, abort the token request where possible, and dispose any camera/client result that resolves after its attempt is stale.
- Implement a server-only `DECART_API_KEY` token route restricted to the selected allowed realtime model. Validate the browser `Origin` against a fixed, server-configured `APP_ORIGINS` allowlist; never derive the allowlist from request `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto` headers. Issue no-store, five-minute client tokens scoped to the requesting allowlisted origin. Never serialize the permanent key into client code.
- Implement a no-store `/api/config/status` route that returns only whether required variables exist and the missing variable names, never their values. Keep the studio page available without configuration, show a clear setup warning, and disable live start until `DECART_API_KEY` and a valid `APP_ORIGINS` entry are configured.
- Implement a dedicated output-only `/obs` route. A session-specific viewer link passes its capability in the URL fragment (not the query string); the browser-side viewer uses the Decart SDK's read-only subscribe operation. Abort pending token fetches on unmount and disconnect any subscriber that resolves after teardown. OBS can load this HTTPS page as a Browser Source. It is not an RTMP/SRT media endpoint.
- Keep the first version's session state in the active browser session; disconnecting ends the session and invalidates the viewer. Do not add user accounts or a database. `APP_ORIGINS` restricts token origins but is not authentication, so any public deployment must add owner access control and rate limits.
- Reference images are selected and previewed locally, replaced or cleared explicitly, and only applied to an active session after user action. Show an applying/clearing state and prevent overlapping image operations. Validate supported image MIME types and size. Do not add prompt fields or image/video editing tools.

## Project structure

- `app/` — Next.js App Router pages and route handlers.
  - `app/page.tsx` — Studio interface.
  - `app/obs/page.tsx` — clean OBS subscriber canvas.
  - `app/api/realtime-token/route.ts` — server-only short-lived token minting.
  - `app/api/config/status/route.ts` — secret-free setup status response.
- `components/` — app-specific compositions built from Mantine components: live preview, reference image control, session controls, and OBS link panel.
- `lib/` — realtime model allowlist and server-only origin/configuration helpers.
- `public/manus-routes.json` — declared browser pages for `/` and `/obs` (API routes are excluded).
- `.env.example` — required server-side variable names and safe local origin example; never a real credential.
- `plan.md` — this implementation/design plan.
- `TODO.md` — outcome criteria carried from the approved scope.

## Design direction

- **Design movement:** A quiet broadcast-control console: modern editorial restraint with a compact creator-studio feel.
- **Core principles:** Obvious live state; controls stay close to their media; meaningful empty/error states; familiar, accessible components over novelty.
- **Color philosophy:** A deep ink canvas makes video the focus; warm near-white panels keep the controls approachable; one electric teal accent signals active media and connection state. Semantic amber/red are reserved for warnings and failures.
- **Layout paradigm:** A responsive AppShell with a narrow navigation/header band, an asymmetric main stage for input/output video, and a compact side rail for reference image and session actions. Collapse the side rail into stacked sections on small screens; avoid a dense dashboard grid.
- **Signature elements:** A small live-status pill with a restrained pulse only while connected; paired local/output video panels; a clearly framed reference-image tile with active/empty states.
- **Interaction philosophy:** No hidden gestures. Use explicit buttons for start, stop, select, replace, apply, clear, and copy. Keep selections visible and provide immediate confirmation for state changes.
- **Animation:** Use short 120–180ms transitions from the component library. Animate the live indicator only while processing. Honor reduced-motion settings; do not animate video itself or obstruct controls.
- **Typography system:** Mantine's sans-serif UI stack for labels and body; a compact monospace face only for technical connection/usage metadata. Keep headings short and size hierarchy modest.
- **Brand essence:** LiveBridge gives a creator one calm place to transform a camera feed and route its output to OBS. Personality: clear, calm, capable.
- **Brand voice:** Direct, reassuring microcopy. Examples: “Choose a reference image to guide the live look.” “Copy this link into OBS as a Browser Source.”
- **Wordmark & logo:** A compact, custom aperture/bridge glyph beside the LiveBridge wordmark.
- **Signature brand color:** Electric teal, used sparingly for the active stream, selected reference, and primary action.

# LiveBridge implementation plan

## Product scope

Build a minimal self-hosted Next.js interface over the official Decart JavaScript SDK. The app will transform a browser camera stream through Decart-hosted realtime inference, give the user direct image-reference controls, and provide a clean OBS Browser Source viewer page for the transformed session. Exclude prompt editing and image/video editing workspaces. The permanent Decart API key stays on the server; the browser receives only short-lived client tokens. The UI must disclose that inference itself runs on Decart, not on the self-hosted machine.

## Implementation approach

- Use Next.js App Router with TypeScript and Node.js server runtime.
- Use Mantine's ready-made AppShell, Paper, Group/Stack, Tabs, Button, Select, Dropzone, FileInput, Badge, Alert, Progress, Tooltip, CopyButton, AspectRatio and related core components. Use `@tabler/icons-react` for icons. Compose these components into the requested screens rather than inventing replacement controls or a custom component system.
- Integrate `@decartai/sdk` for realtime connect/subscribe. The Studio page acquires the selected camera and optional microphone, shows local and transformed streams, changes to a selected reference image during a session, tracks connection state/usage, and disconnects/stops tracks on teardown.
- Implement a server route that mints short-lived Decart client tokens from a server-only `DECART_API_KEY`, restricted to the app origin and the realtime model selected by the client. Never serialize the permanent key into client code.
- Implement a dedicated output-only `/obs` route. A session-specific, revocable viewer link passes its capability in the URL fragment (not the query string); the browser-side viewer uses the Decart SDK's read-only subscribe operation. OBS can load this HTTPS page as a Browser Source. It is not an RTMP/SRT media endpoint.
- Keep the first version's session state in the active browser session; disconnecting ends the session and invalidates the viewer. Do not add user accounts or a database. Document that any public deployment should sit behind owner access control because its server token endpoint is billable.
- Reference images are selected locally, previewed, replaced or cleared, and applied to the live session only after user action. Validate supported image MIME types and size. Do not add prompt fields or image/video editing tools.
- Without a Decart key, show a clear unconfigured state while allowing the UI to load; a live API session cannot be honestly demonstrated until the key is supplied.

## Project structure

- `app/` — Next.js App Router pages and route handlers.
  - `app/page.tsx` — Studio interface.
  - `app/obs/page.tsx` — clean OBS subscriber canvas.
  - `app/api/realtime-token/route.ts` — server-only short-lived token minting.
- `components/` — app-specific compositions built from Mantine components: live preview, reference image control, session controls, and OBS link panel.
- `lib/` — Decart client/model configuration, camera/media helpers, and viewer-link utilities.
- `public/manus-routes.json` — declared browser pages for `/` and `/obs`.
- `.env.example` — names and descriptions for required server-side configuration; never a real credential.
- `plan.md` — this implementation/design plan.
- `TODO.md` — outcome criteria carried from the approved scope.

## Design direction

- **Design movement:** A quiet broadcast-control console: modern editorial restraint with a compact creator-studio feel.
- **Core principles:** Obvious live state; controls stay close to their media; meaningful empty/error states; familiar, accessible components over novelty.
- **Color philosophy:** A deep ink canvas makes video the focus; warm near-white panels keep the controls approachable; one electric teal accent signals active media and connection state. Semantic amber/red are reserved for warnings and failures.
- **Layout paradigm:** A responsive AppShell with a narrow navigation/header band, an asymmetric main stage for input/output video, and a compact side rail for reference image and session actions. Collapse the side rail into stacked sections on small screens; avoid a dense dashboard grid.
- **Signature elements:** A small live-status pill with a restrained pulse only while connected; paired local/output video panels; a clearly framed reference-image tile with active/empty states.
- **Interaction philosophy:** No hidden gestures. Use explicit buttons for start, stop, select, replace, clear, and copy. Keep selections visible and provide immediate confirmation for state changes.
- **Animation:** Use short 120–180ms transitions from the component library. Animate the live indicator only while processing. Honor reduced-motion settings; do not animate video itself or obstruct controls.
- **Typography system:** Mantine's sans-serif UI stack for labels and body; a compact monospace face only for technical connection/usage metadata. Keep headings short and size hierarchy modest.
- **Brand essence:** LiveBridge gives a creator one calm place to transform a camera feed and route its output to OBS. Personality: clear, calm, capable.
- **Brand voice:** Direct, reassuring microcopy. Examples: “Choose a reference image to guide the live look.” “Copy this link into OBS as a Browser Source.”
- **Wordmark & logo:** A compact aperture/bridge glyph beside the LiveBridge wordmark, implemented with a standard Tabler icon rather than a bespoke illustration.
- **Signature brand color:** Electric teal, used sparingly for the active stream, selected reference, and primary action.

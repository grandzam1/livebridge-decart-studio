# Build references

- Decart JavaScript SDK overview: https://docs.platform.decart.ai/sdks/javascript — `@decartai/sdk` exposes realtime WebRTC, queued video processing, and synchronous image processing. Realtime browser apps should avoid exposing the permanent API key and may use short-lived client tokens scoped to allowed models and origins. The currently documented token default is 60 seconds, with configurable expiry from 1 to 3600 seconds.
- Decart realtime SDK: https://docs.platform.decart.ai/sdks/javascript-realtime — realtime connect returns a transformed `MediaStream`; prompt/reference state can be updated while connected, reference images can be files/blobs/URLs, and `subscribeToken` lets read-only viewers receive the active transformed stream. Connection and usage events are available.
- Decart realtime model docs: https://docs.platform.decart.ai/models/realtime/video-restyling — the realtime restyling model takes a video stream and image/style reference, supports dynamic updates and runs over WebRTC.
- Decart queue docs: https://docs.platform.decart.ai/sdks/javascript-queue — asynchronous API for video transformation; not needed in this initial live-only scope.
- Decart image-process docs: https://docs.platform.decart.ai/sdks/javascript-process — synchronous image editing; excluded from this initial scope.
- Mantine: https://mantine.dev/ — official site describes a fully featured React components library with more than 120 components and 70 hooks.
- Mantine Dropzone: https://mantine.dev/x/dropzone/ — official dropzone is based on `react-dropzone` and supports accept/reject handling, MIME types, file-size limits and drag/drop states.
- Tabler Icons: https://tabler.io/icons — open-source vector icon catalog with a React package; use for conventional control icons, not decorative imagery.
- OBS Browser Source: https://obsproject.com/kb/browser-source — OBS embeds a web page as a browser source and supports a URL plus viewport dimensions and custom frame rate. Therefore this app can provide a viewer webpage URL, not a raw RTMP/SRT endpoint.
- Next.js Route Handlers: https://nextjs.org/docs/app/building-your-application/routing/route-handlers — App Router supports custom HTTP request handlers such as a server-side token endpoint.

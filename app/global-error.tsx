"use client";

import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("LiveBridge failed to render.", error);
  }, [error]);

  return (
    // global-error replaces the root layout, so it must render its own document.
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#101113", color: "#e9ecef" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 20, marginBottom: 12 }}>LiveBridge hit an unexpected error</h1>
            <p style={{ fontSize: 14, color: "#909296", marginBottom: 20 }}>
              {error instanceof globalThis.Error && error.message ? error.message : "Something went wrong while rendering this page."}
            </p>
            <button
              type="button"
              onClick={() => retry()}
              style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#12b886", color: "#fff", fontSize: 14, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

"use client";

import { MantineProvider, createTheme } from "@mantine/core";
import type { ReactNode } from "react";

const theme = createTheme({
  primaryColor: "teal",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  fontFamilyMonospace: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  defaultRadius: "md",
  cursorType: "pointer",
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {children}
    </MantineProvider>
  );
}

"use client";

import { MantineProvider, createTheme } from "@mantine/core";
import type { ReactNode } from "react";

const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  cursorType: "pointer",
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="dark">
      {children}
    </MantineProvider>
  );
}

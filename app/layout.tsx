import type { Metadata } from "next";
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "LiveBridge — Decart Live Studio",
  description: "A simple live camera studio with image-reference controls and an OBS Browser Source output.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

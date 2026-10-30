import type { Metadata } from "next";
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { publicConfig } from "@/lib/public-config";

export const metadata: Metadata = {
  title: `${publicConfig.branding.appName} — Decart Live Studio`,
  description: "A simple live camera studio with image-reference controls and an OBS Browser Source output.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-mantine-color-scheme="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

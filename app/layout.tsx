import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HostDeck — Infrastructure OS",
  description: "Central desktop para hospedagens, observabilidade, plugins e Gemini Intelligence.",
  icons: { icon: "/brand/hostdeck-mark.svg", shortcut: "/brand/hostdeck-mark.svg", apple: "/brand/hostdeck-mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="pt-BR" suppressHydrationWarning><body>{children}</body></html>;
}

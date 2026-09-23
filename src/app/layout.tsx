import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Video Context Lab", description: "Understand and interrogate short videos." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

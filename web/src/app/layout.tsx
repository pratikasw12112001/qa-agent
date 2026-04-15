import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontend QA Agent",
  description: "Compare Figma designs against live UI automatically",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

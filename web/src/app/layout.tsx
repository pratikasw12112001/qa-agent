import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Agent",
  description: "Automated frontend QA testing — Figma vs Live",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

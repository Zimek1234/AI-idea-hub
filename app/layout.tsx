import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AI Idea Hub — A shared place for what’s next",
  description:
    "Your private, collaborative library of AI tools, ideas, and experiments.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

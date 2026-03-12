import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Collaborative Editor",
  description: "Real-time collaborative editor built with Next.js, TipTap, and Yjs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeInitScript = `
    (function() {
      try {
        var key = "collaborative-editor:theme";
        var stored = window.localStorage.getItem(key);
        var system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        var theme = stored === "dark" || stored === "light" ? stored : system;
        document.documentElement.setAttribute("data-theme", theme);
      } catch (e) {
        document.documentElement.setAttribute("data-theme", "light");
      }
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

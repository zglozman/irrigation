import type { Metadata } from "next";
import { Sora, Karla, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const karla = Karla({
  variable: "--font-karla",
  subsets: ["latin"],
});

const splineSansMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "sprout",
  description: "your garden, watered wisely",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${karla.variable} ${splineSansMono.variable} h-full antialiased`}
    >
      <body className="bg-page text-ink min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}

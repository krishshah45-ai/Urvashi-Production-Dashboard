import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Urvashi Production Dashboard",
  description: "Daily production, power, chemical and wastage KPIs for Urvashi Pulp & Paper Mill.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-[var(--border)] px-4 py-3 flex items-center justify-between sticky top-0 bg-[var(--page)]/95 backdrop-blur z-10">
          <Link href="/" className="text-sm tracking-widest text-[var(--text-secondary)] uppercase">
            urvashi<span className="text-[var(--series-1)]">/</span>dashboard
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              dashboard
            </Link>
            <Link href="/upload" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              upload
            </Link>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}

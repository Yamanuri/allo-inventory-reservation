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
  title: "Allo Fulfillment Hub - Inventory Reservation Platform",
  description: "Real-time reservation system to protect stock from double-fulfillment and checkout race conditions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[#08070d] text-slate-100 selection:bg-indigo-500/30 selection:text-indigo-200">
        
        {/* Global Premium Top Nav */}
        <header className="sticky top-0 z-50 w-full border-b border-slate-900 bg-[#08070d]/75 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="h-6 w-6 bg-gradient-to-tr from-indigo-500 to-pink-500 rounded-lg flex items-center justify-center font-black text-white text-xs select-none shadow-md shadow-indigo-500/20">
                A
              </span>
              <span className="font-extrabold text-sm tracking-tight text-white">
                Allo Health
              </span>
            </div>
            
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-400">
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-900/50 rounded-full text-emerald-400 text-[10px]">
                <span className="h-1.5 w-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                System Live
              </span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 flex flex-col">
          {children}
        </div>

        {/* Global Premium Footer */}
        <footer className="border-t border-slate-900/60 bg-slate-950/20 py-8">
          <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-500">
            <p>© 2026 Allo Health Inc. All rights reserved.</p>
            <div className="flex gap-4">
              <span className="hover:text-slate-400 transition cursor-default">Privacy Policy</span>
              <span className="hover:text-slate-400 transition cursor-default">Terms of Service</span>
            </div>
          </div>
        </footer>

      </body>
    </html>
  );
}

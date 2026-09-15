import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MY shop production",
  description: "Výrobná appka pre eshop MERCHYOU.shop",
  icons: {
    icon: "/brand/icon_MY.svg",
  },
  // iOS Safari inak automaticky rozpoznáva čísla podobné telefónnym číslam
  // (napr. Design ID) a mení ich na klikateľný odkaz s vlastným štýlom — na
  // niektoré deväťmiestne čísla to Safari "uverí", na iné nie, čo spôsobovalo
  // nekonzistentné zalamovanie hlavičky karty medzi jednotlivými položkami.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}

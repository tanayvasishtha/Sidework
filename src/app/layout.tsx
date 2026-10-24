import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sidework",
  description:
    "Splits restaurant tip pools by the rules and pays staff the same night through PayPal and Venmo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

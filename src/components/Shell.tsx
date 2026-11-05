import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { settings } from "@/lib/settings";
import styles from "./Shell.module.css";

const links = [{ href: "/tonight", label: "Tonight" }];

const MODE_LABEL = { live: "live", record: "recording", replay: "replay" } as const;

/** Read per request. In the static shell it would freeze whatever was true at build time. */
async function ModeBadge() {
  await connection();
  const { mode, paypalMode, llmMode } = settings();
  const label =
    paypalMode === llmMode ? (mode === "replay" ? "Replay" : "Live sandbox") : `PayPal ${MODE_LABEL[paypalMode]}, AI ${MODE_LABEL[llmMode]}`;
  return (
    <span
      className={styles.mode}
      title={
        mode === "replay"
          ? "Running from responses recorded against the PayPal sandbox and OpenAI. Add keys to go live."
          : "Calling the PayPal sandbox and OpenAI"
      }
    >
      {label}
    </span>
  );
}

export function Shell({ current, children }: { current: string; children: React.ReactNode }) {
  return (
    <>
      <header className={styles.bar}>
        <Link href="/tonight" className={styles.brand}>
          Sidework
        </Link>
        <nav className={styles.nav} aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.meta}>
          <Suspense fallback={null}>
            <ModeBadge />
          </Suspense>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}

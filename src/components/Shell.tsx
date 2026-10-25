import Link from "next/link";
import { settings } from "@/lib/settings";
import styles from "./Shell.module.css";

const links = [{ href: "/tonight", label: "Tonight" }];

export function Shell({
  current,
  restaurant,
  children,
}: {
  current: string;
  restaurant: string;
  children: React.ReactNode;
}) {
  const { mode } = settings();
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
          <span>{restaurant}</span>
          <span
            className={styles.mode}
            title={mode === "replay" ? "Running from recorded responses. Add keys to go live." : "Calling PayPal sandbox and OpenAI"}
          >
            {mode === "replay" ? "Replay" : "Live sandbox"}
          </span>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { db, getRestaurant, LUCIAS } from "@/lib/db";
import { PolicyAudit } from "./PolicyAudit";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Tip policy check | Sidework" };

export default function PolicyPage({ searchParams }: PageProps<"/policy">) {
  return (
    <Shell current="/policy">
      <Suspense fallback={<p className={styles.loading}>Opening the tip policy</p>}>
        <Policy searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}

async function Policy({ searchParams }: { searchParams: PageProps<"/policy">["searchParams"] }) {
  await connection();
  const { r } = await searchParams;
  const d = db();
  const places = d.prepare("select id, name from restaurants order by name").all() as { id: string; name: string }[];
  const id = typeof r === "string" && places.some((p) => p.id === r) ? r : LUCIAS;
  const restaurant = getRestaurant(d, id);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Is your tip policy legal?</h1>
        <nav className={styles.places} aria-label="Restaurants">
          {places.map((p) => (
            <Link key={p.id} href={`/policy?r=${p.id}`} aria-current={p.id === id ? "page" : undefined}>
              {p.name}
            </Link>
          ))}
        </nav>
      </div>
      <p className={styles.lede}>
        The agent reads your handbook and quotes what it says. The rules engine then checks those exact words against
        federal tip law. Federal rules only, and not legal advice.
      </p>
      <PolicyAudit key={id} restaurantId={id} policyText={restaurant.policyText} />
    </div>
  );
}

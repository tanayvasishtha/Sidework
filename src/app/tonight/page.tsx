import { Shell } from "@/components/Shell";
import styles from "./page.module.css";

export default function Tonight() {
  return (
    <Shell current="/tonight" restaurant="Lucia's">
      <section className={styles.empty}>
        <h1>No tips in yet tonight</h1>
        <p>Tips show up here as tables pay with PayPal or Venmo.</p>
      </section>
    </Shell>
  );
}

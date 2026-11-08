# Sidework

Splits restaurant tip pools by the rules and pays staff the same night through PayPal and Venmo.

<!-- Live URL and a 30-second GIF go here once the Render deploy is up. -->

At close, a manager writes what changed on the shift in plain words. Sidework updates the schedule, checks the tip pool against federal tip law, keeps automatic gratuities out of the qualified tips, and has an AI agent work out the split on its own so a rules engine can check it to the cent. Once the manager approves, everyone is paid through PayPal Payouts to their Venmo or PayPal account. Each worker gets a private link showing how their share was figured, their qualified tips for the year, and the tip codes their W-2 now has to carry.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com), 2026.

## The problem

- Since tax year 2025, US workers in tipped jobs can deduct up to $25,000 a year of qualified tips from federal income tax, through 2028 ([IRC section 224](https://www.law.cornell.edu/uscode/text/26/224)). By July 2026, more than 7.5 million filers had claimed it, averaging over $7,000 each ([Treasury](https://home.treasury.gov/news/press-releases/sb0553)).
- Automatic gratuities, like 18% added for large parties, are not qualified tips. Money a guest adds on top of one is ([26 CFR 1.224-1(c)(4)](https://www.irs.gov/irb/2026-18_IRB)). When both land in the same pool, the gratuity has to be taken back out before anyone reports tips.
- Tax year 2026 is the first year W-2s must report tips separately (box 12, code TP) with a Treasury tipped occupation code (box 14b). Mix the money up and a worker's deduction is built on the wrong number.
- Tip pools have their own federal rules. Managers can't share. Kitchen staff can share only when the restaurant takes no tip credit. With a tip credit, only staff who customarily get tips can share ([29 CFR 531.54](https://www.law.cornell.edu/cfr/text/29/531.54)).
- In March 2026 a federal court ordered Perry's Steakhouse to pay about $21 million because its pool paid pre-opening staff who weren't customarily tipped, which cost it the tip credit for about 707 servers ([Paschal v. Perry's Restaurants, W.D. Tex.](https://www.govinfo.gov/content/pkg/USCOURTS-txwd-1_22-cv-00027/pdf/USCOURTS-txwd-1_22-cv-00027-7.pdf)). Perry's has said it will appeal.

Sidework is for the general manager of a 15 to 40 person US restaurant who splits the pool at 1am, and for the servers who want to know where their money went.

## How it works

| Step | What happens | Where it runs |
|---|---|---|
| Money in | Tonight's PayPal, Venmo, card and cash tips are sorted into qualified tips and service charges. Card fees come off at cost. | Rules engine |
| Shift note | "Sam called out sick. Maria cut at 9. Jake covered bar after 8." becomes schedule edits. Each edit must quote the note word for word and fit the schedule, or it's rejected with a reason. | Agent (OpenAI), checked by code |
| Pool check | Flags managers, kitchen staff under a tip credit, and off-hours crews under a tip credit, each with its citation. Payment is blocked until the manager takes the person out. | Rules engine |
| Two keys | The agent reads the written tip policy and the shifts on its own and reports who worked what at which rate. The same exact arithmetic turns both readings into cents. Any difference stops payment until the manager looks. The engine's split is the one paid. | Agent and rules engine |
| Pay | One PayPal Payouts batch, one item per person, to Venmo or PayPal. A lost response is retried with the same batch id, so nobody is paid twice. | PayPal Payouts API |
| Status | Each payout moves from sending to paid, or to unclaimed. PayPal webhooks are checked with PayPal's signature verification API, and the batch is also read back every few seconds. | PayPal Webhooks and Payouts APIs |
| Worker check | A signed private link shows the math, the year's qualified tips against the $25,000 cap, and the W-2 codes. "Why less than Friday?" is answered by the agent, and every dollar figure in its answer is checked against the ledger. If one doesn't match, the worker gets the ledger's own math. | Agent, checked by code |
| Policy audit | Paste a handbook. The agent quotes what it says, the engine judges those exact words against federal rules, and anything the agent claims that isn't in the text is dropped and listed. | Agent, judged by rules engine |

In every step the agent only reads. Code checks what it read, and payments use only numbers the rules engine produced.

**PayPal APIs used:** OAuth 2.0 client credentials, Payouts (`POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}`) with `recipient_wallet` set to `VENMO` or `PAYPAL` per person, and Webhooks (`POST /v1/notifications/verify-webhook-signature`, `PAYMENT.PAYOUTS-ITEM.*` and `PAYMENT.PAYOUTSBATCH.*` events). Sandbox only: the app refuses to send money anywhere else.

## Results

From `npm run eval` ([eval/RESULTS.md](eval/RESULTS.md)) on 56 test nights with known answers, 24 of them with a planted violation:

| Measure | Spreadsheet | Sidework |
|---|---|---|
| Nights split right to the cent, of 56 | 21 | 56 |
| Illegal pool members caught, of 24 | 0 | 24 |
| False alarms on 32 nights with no violation | 0 | 0 |
| Money paid to the wrong people | $3,701.35 | $0.00 |
| Added gratuities handled right, of 12 nights | 1 | 12 |
| Service charges counted as qualified tips | $1,936.44 | $0.00 |

- The answer key is [eval/oracle.ts](eval/oracle.ts): exact integer arithmetic that shares no code with the engine. Violations are labelled by the generator that planted them.
- The spreadsheet uses the same points and card fees as Sidework, with no legal checks, and puts added gratuities in with the tips.
- To show the eval can fail, the engine was broken on purpose in six ways (no manager rule, a wrong kitchen rule, no Perry's rule, gratuities counted as tips, fees rounded down, leftover cents to the wrong person). The eval caught all six.
- The nights are synthetic, written to test known rules. The violation score shows the rules work as designed. It takes facts like who has manager duties as given, so it can't catch a wrong staff record.
- The eval also has an "agent alone" column and 10 handwritten handbooks (5 legal, 5 with an illegal clause) for the policy audit. Both need an OpenAI key, and `npm run eval` fills them in when one is set.

## What broke and how it was fixed

- A stress test of 5,000 random nights against the answer key found that float division put a share one cent off on about 1 night in 1,000. The 56 scenarios had missed it. All money math now runs in whole numbers, and the stress test stays in the suite.
- An early design had the agent compute each share itself. It would miss by a cent, so the check would have meant nothing. Now the agent only reports what it read (hours and rates), and both sides go through the same arithmetic, so a difference is a real disagreement.
- A retry could have paid everyone twice: if PayPal accepted a batch and the response was lost, a new batch id would pay again. Ambiguous failures (no response, timeout, 5xx) now keep the night locked, and the retry resends the same batch id and request id. PayPal won't run a second batch under an id it has already seen, so nobody is paid twice.
- The first draft of the pitch said the Perry's ruling was about managers in the pool. The court record says it was pre-opening staff who weren't customarily tipped. That correction became a rule of its own, and the demo's second restaurant is built on the facts of the case.
- The seeded restaurant first sat in New York and shared tips with the kitchen, which New York bars. Sidework checks federal rules only, so the demo restaurant moved to Texas, which follows them.
- PayPal's sandbox doesn't support the `PHONE` recipient type for Venmo, so sandbox Venmo payouts use email.

## Run it

Needs Node 22.13 or later (tested on Node 24). No keys needed.

```bash
npm install
npm run demo
```

Open http://localhost:3000. The demo has two nights:

- Lucia's, Saturday Nov 7: a floor manager is in the pool and a party of nine has an 18% gratuity. Take Dave out, check the split, then pay.
- Hartley's Chophouse, Friday Nov 6: built on the Perry's facts, with servers at $2.13 an hour and a morning crew in the pool. Sidework blocks it.

The **Tip policy** tab audits a handbook. "Try a policy with problems" loads one with several illegal clauses.

With no keys, the rules engine, close-out, worker checks and eval all run. AI steps and payouts replay from `fixtures/` when a recording of a live run exists, and say so plainly when one doesn't. "Reset demo" puts everything back.

To run live against the PayPal sandbox and OpenAI, copy `.env.example` to `.env.local` and fill it in. To confirm Venmo and PayPal payouts work on your sandbox account:

```bash
npm run sandbox:check -- --venmo <sandbox email> --paypal <sandbox email>
```

Other commands: `npm test` (135 tests), `npm run eval`, `npm run typecheck`, `npm run lint`. With keys set, `REPLAY=record` saves every successful PayPal and OpenAI response to `fixtures/` with tokens blanked.

## Built with

Next.js 16 and React 19, TypeScript, Node's built-in SQLite, the Vercel AI SDK with OpenAI (`gpt-5-mini` by default) for reading notes, policies and questions, PayPal REST APIs for money, Vitest for tests, and Zod for structured AI output.

## Caveats

- Sidework checks federal rules only. State law is not checked, and California and New York, for two, have stricter pool rules. It is not tax or legal advice.
- Payouts run in the PayPal sandbox. No real money moves.
- There is no sign-in. Anyone with the URL can run the demo, and "Reset demo" resets it for everyone.
- Guests can't pay at the table yet, so tonight's tips are seeded. The schedule is a plain timeline.
- Demo data is invented. Restaurant and staff names are fictional.

## Hackathon fit

Sidework uses PayPal to move money, through Payouts and webhooks, and it uses AI where a script can't: reading a handbook, a shift note or a worker's question. Every AI answer goes through a check before it can touch a payment. It is aimed at the Best PayPal + AI and Most Impactful categories.

## License

MIT. See [LICENSE](LICENSE).

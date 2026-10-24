# Sidework

Splits restaurant tip pools by the rules and pays staff the same night through PayPal and Venmo.

Built for the PayPal AI Hackathon, 2026. Work in progress.

## The problem

At close, a manager splits the night's tips across servers, bartenders, bussers and sometimes the kitchen. Two rules make this risky:

- Federal law bars managers and supervisors from any share of a tip pool.
- Since 2025, tipped workers can deduct up to $25,000 of qualified tips a year. Automatic gratuities don't count, and from tax year 2026 employers report qualified tips on the W-2.

## What Sidework does

- Takes tonight's tips from PayPal and Venmo payments at the table.
- Turns the manager's notes about the shift into schedule changes.
- Checks the pool against the federal rules before any money moves.
- Separates automatic gratuities from qualified tips.
- Works out each person's share twice and holds payment if the two don't match.
- Pays everyone through PayPal Payouts to Venmo or PayPal.
- Shows each worker how their share was worked out and their qualified tips for the year.

## Run it

```
npm install
npm run dev
```

## License

MIT

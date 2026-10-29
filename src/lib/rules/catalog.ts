import type { RuleId } from "./types";

export type RuleInfo = { title: string; source: string; url: string };

export const RULES: Record<RuleId, RuleInfo> = {
  "FLSA-MGR": {
    title: "Managers and supervisors can't receive money from a tip pool",
    source: "29 U.S.C. 203(m)(2)(B); 29 CFR 531.54; manager test in 29 CFR 531.52(b)(2)",
    url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-B/part-531/subpart-D/section-531.54",
  },
  "FLSA-BOH": {
    title: "Kitchen staff can share in the pool only when no tip credit is taken",
    source: "29 CFR 531.54(c) and (d)",
    url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-B/part-531/subpart-D/section-531.54",
  },
  "FLSA-CRT": {
    title: "With a tip credit, only staff who customarily and regularly get tips can share",
    source: "29 U.S.C. 203(m)(2)(A); 29 CFR 531.54(c); Paschal v. Perry's Restaurants, W.D. Tex. 2026",
    url: "https://www.govinfo.gov/content/pkg/USCOURTS-txwd-1_22-cv-00027/pdf/USCOURTS-txwd-1_22-cv-00027-7.pdf",
  },
  "FLSA-FULL": {
    title: "Every dollar in the pool goes to the people in it",
    source: "29 CFR 531.54",
    url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-B/part-531/subpart-D/section-531.54",
  },
  "FLSA-FEE": {
    title: "Only the actual card processing fee can come off card tips",
    source: "DOL Fact Sheet 15",
    url: "https://www.dol.gov/agencies/whd/fact-sheets/15-tipped-employees-flsa",
  },
  "FLSA-PAY": {
    title: "Tips are due by the regular payday for the week they were earned",
    source: "29 CFR 531.54(b)(2)",
    url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-B/part-531/subpart-D/section-531.54",
  },
  "IRS-AUTO": {
    title: "An added gratuity is a service charge, not a qualified tip, unless the guest could change it",
    source: "26 CFR 1.224-1(c)(4), final regulations T.D. 10044",
    url: "https://www.irs.gov/irb/2026-18_IRB",
  },
  "IRS-OVER": {
    title: "Money a guest freely adds above an added gratuity is a qualified tip",
    source: "26 CFR 1.224-1(c)(4), final regulations T.D. 10044",
    url: "https://www.irs.gov/irb/2026-18_IRB",
  },
  "IRS-TTOC": {
    title: "Each tipped worker needs a Treasury tipped occupation code on their W-2",
    source: "Form W-2 instructions, box 14b",
    url: "https://www.irs.gov/instructions/iw2w3",
  },
};

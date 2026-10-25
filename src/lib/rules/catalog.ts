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
    source: "29 CFR 531.54",
    url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-B/part-531/subpart-D/section-531.54",
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
};

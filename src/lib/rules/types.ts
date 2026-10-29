export type Role =
  | "server"
  | "bartender"
  | "busser"
  | "runner"
  | "barback"
  | "host"
  | "cook"
  | "dishwasher"
  | "manager";

export type StaffMember = {
  id: string;
  name: string;
  role: Role;
  /** Can hire, fire or set schedules. Decides the federal manager test, whatever the job title says. */
  managerDuties: boolean;
};

/** One stretch of work at one station. A person who moved from floor to bar has two. */
export type Shift = {
  staffId: string;
  station: Role;
  /** "17:00". An end at or before the start rolls past midnight. */
  start: string;
  end: string;
};

export type Policy = {
  /** Pool points earned per hour at each station. Zero keeps a station out of the pool. */
  pointsPerHour: Partial<Record<Role, number>>;
  /** True when the restaurant pays tipped staff below minimum wage and counts tips toward it. */
  takesTipCredit: boolean;
  /** Processing fee taken from card, PayPal and Venmo tips before the split, as a fraction. 0 for none. */
  cardFeeRate: number;
  /** When guests are served, "16:00" to "23:00". A close at or before the open runs past midnight. */
  serviceHours?: { open: string; close: string };
};

export type RuleId =
  | "FLSA-MGR"
  | "FLSA-BOH"
  | "FLSA-CRT"
  | "FLSA-FULL"
  | "FLSA-FEE"
  | "IRS-AUTO"
  | "IRS-OVER"
  | "IRS-TTOC";

export type Flag = {
  ruleId: RuleId;
  staffId?: string;
  message: string;
  /** "block" stops payment until someone fixes it. */
  severity: "block" | "warn";
};

export type Allocation = {
  staffId: string;
  minutes: number;
  points: number;
  cents: number;
  /** Cents added from rounding, so the pool pays out exactly. */
  remainderCents: number;
};

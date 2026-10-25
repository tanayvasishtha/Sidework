import { describe, expect, it } from "vitest";
import { checkOccupationCodes, classifyNight, occupationCode } from "./index";
import type { Policy, StaffMember, TipLine } from "./index";

const policy: Policy = { pointsPerHour: { server: 1 }, takesTipCredit: false, cardFeeRate: 0.029 };

const line = (over: Partial<TipLine>): TipLine => ({
  id: "t1",
  source: "paypal",
  tipCents: 0,
  autoGratuityCents: 0,
  guestCouldChangeAutoGratuity: false,
  ...over,
});

describe("classifyNight", () => {
  it("keeps an added gratuity out of the tip pool", () => {
    const night = classifyNight(
      [line({ id: "table12", autoGratuityCents: 18000 }), line({ id: "table7", tipCents: 1633 })],
      { ...policy, cardFeeRate: 0 },
    );
    expect(night.serviceChargeCents).toBe(18000);
    expect(night.tipPoolCents).toBe(1633);
  });

  it("counts an added gratuity as a tip when the guest could change it", () => {
    const night = classifyNight(
      [line({ autoGratuityCents: 18000, guestCouldChangeAutoGratuity: true })],
      { ...policy, cardFeeRate: 0 },
    );
    expect(night.tipPoolCents).toBe(18000);
    expect(night.serviceChargeCents).toBe(0);
    expect(night.flags[0]?.ruleId).toBe("IRS-AUTO");
  });

  it("treats a tip on top of an added gratuity as qualified", () => {
    const night = classifyNight([line({ tipCents: 2000, autoGratuityCents: 18000 })], {
      ...policy,
      cardFeeRate: 0,
    });
    expect(night.tipPoolCents).toBe(2000);
    expect(night.flags[0]?.ruleId).toBe("IRS-OVER");
  });

  it("takes the processing fee off electronic tips only", () => {
    const night = classifyNight(
      [line({ source: "card", tipCents: 10000 }), line({ id: "t2", source: "cash", tipCents: 5000 })],
      policy,
    );
    expect(night.feeCents).toBe(290);
    expect(night.tipPoolCents).toBe(14710);
  });

  it("rejects negative amounts", () => {
    expect(() => classifyNight([line({ tipCents: -1 })], policy)).toThrow("negative");
  });
});

describe("occupation codes", () => {
  it("maps restaurant roles to Treasury codes", () => {
    expect(occupationCode("bartender")?.code).toBe(101);
    expect(occupationCode("server")?.code).toBe(102);
    expect(occupationCode("busser")?.code).toBe(104);
    expect(occupationCode("host")?.code).toBe(109);
    expect(occupationCode("manager")).toBeUndefined();
  });

  it("flags paid staff with no code", () => {
    const staff: StaffMember[] = [
      { id: "ana", name: "Ana", role: "host", managerDuties: false },
      { id: "dave", name: "Dave", role: "manager", managerDuties: true },
    ];
    const flags = checkOccupationCodes(staff, ["ana", "dave"]);
    expect(flags).toEqual([expect.objectContaining({ ruleId: "IRS-TTOC", staffId: "dave" })]);
  });
});

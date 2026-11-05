/** Minutes on the service night, which runs 06:00 to 05:59, so 00:40 sorts after 23:00. */
export function nightMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m - 360 + 1440) % 1440;
}

/** A shift as a range on the service night. An end at or before the start runs past midnight. */
export function shiftSpan(shift: { start: string; end: string }): [number, number] {
  const start = nightMinutes(shift.start);
  const length = (nightMinutes(shift.end) - start + 1440) % 1440 || 1440;
  return [start, start + length];
}

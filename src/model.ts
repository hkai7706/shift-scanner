import { DateTime } from "luxon";
export type Rules = {
  rate: number;
  multiplier: number;
  nightStart: string;
  nightEnd: string;
  block: number;
  rounding: "nearest" | "floor" | "none";
};
export type Session = {
  id: string;
  start: number;
  end?: number;
  zone: string;
  breaks: { start: number; end?: number }[];
  rules: Rules;
  shiftId?: string;
  lastAction: number;
};
export type Shift = {
  id: string;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
  source?: string;
  page?: number;
};
export type Settings = {
  name: string;
  aliases: string;
  language: "en" | "ja";
  theme: "light" | "dark" | "system";
  scannerUrl: string;
  rules: Rules;
};
export type State = {
  version: 1;
  settings: Settings;
  shifts: Shift[];
  sessions: Session[];
};
export const defaultRules: Rules = {
  rate: 1200,
  multiplier: 1.43,
  nightStart: "22:00",
  nightEnd: "05:00",
  block: 15,
  rounding: "nearest",
};
export const initial: State = {
  version: 1,
  settings: {
    name: "ゼーリン",
    aliases: "",
    language: "en",
    theme: "light",
    scannerUrl: import.meta.env.VITE_SCANNER_URL || "",
    rules: defaultRules,
  },
  shifts: [],
  sessions: [],
};
export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
export const monthOf = (s: Session) =>
  DateTime.fromMillis(s.start, { zone: s.zone }).toFormat("yyyy-MM");
export function validateSession(s: Session, now = Date.now()) {
  const end = s.end ?? now;
  if (
    !Number.isFinite(s.start) ||
    !Number.isFinite(end) ||
    end < s.start ||
    end - s.start > 7 * 86400000
  )
    throw Error("Invalid or unusually long session. Correct the timestamps.");
  let prev = s.start;
  for (const [i, b] of s.breaks.entries()) {
    const e = b.end ?? end;
    if (
      !Number.isFinite(b.start) ||
      !Number.isFinite(e) ||
      (!b.end && (s.end !== undefined || i !== s.breaks.length - 1)) ||
      b.start < prev ||
      e < b.start ||
      e > end ||
      b.start < s.start
    )
      throw Error(
        "Breaks must be ordered, inside the session, and must not overlap.",
      );
    prev = e;
  }
  if (!DateTime.fromMillis(s.start, { zone: s.zone }).isValid)
    throw Error("Invalid timezone");
  validateRules(s.rules);
}
export function validateRules(r: Rules) {
  if (
    !r ||
    !Number.isFinite(r.rate) ||
    r.rate < 0 ||
    !Number.isFinite(r.multiplier) ||
    r.multiplier < 0 ||
    !Number.isFinite(r.block) ||
    r.block < 1 ||
    r.block > 60 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.nightStart) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.nightEnd) ||
    r.nightStart === r.nightEnd ||
    !["nearest", "floor", "none"].includes(r.rounding)
  )
    throw Error("Invalid pay rules");
}
export function calculate(s: Session, now = Date.now()) {
  validateSession(s, now);
  const end = s.end ?? now;
  let cursor = s.start;
  const work: [number, number][] = [];
  let breakMs = 0;
  for (const b of s.breaks) {
    if (b.start > cursor) work.push([cursor, b.start]);
    cursor = b.end ?? end;
    breakMs += cursor - b.start;
  }
  if (cursor < end) work.push([cursor, end]);
  let nightMs = 0;
  const [sh, sm] = s.rules.nightStart.split(":").map(Number),
    [eh, em] = s.rules.nightEnd.split(":").map(Number);
  let day = DateTime.fromMillis(s.start, { zone: s.zone })
    .startOf("day")
    .minus({ days: 1 });
  while (day.toMillis() < end) {
    const ns = day.set({ hour: sh, minute: sm });
    let ne = day.set({ hour: eh, minute: em });
    if (ne <= ns) ne = ne.plus({ days: 1 });
    for (const [a, b] of work)
      nightMs += Math.max(
        0,
        Math.min(b, ne.toMillis()) - Math.max(a, ns.toMillis()),
      );
    day = day.plus({ days: 1 });
  }
  const workMs = work.reduce((n, [a, b]) => n + b - a, 0),
    regularMs = workMs - nightMs,
    payableNightMs =
      Math.floor(nightMs / (s.rules.block * 60000)) * s.rules.block * 60000;
  const regularPay = (regularMs / 3600000) * s.rules.rate,
    nightPay = (payableNightMs / 3600000) * s.rules.rate * s.rules.multiplier,
    raw = regularPay + nightPay;
  return {
    workMs,
    breakMs,
    regularMs,
    nightMs,
    payableNightMs,
    regularPay,
    nightPay,
    total:
      s.rules.rounding === "nearest"
        ? Math.round(raw)
        : s.rules.rounding === "floor"
          ? Math.floor(raw)
          : raw,
  };
}
export const duration = (ms: number) =>
  `${Math.floor(ms / 3600000)}h ${Math.floor(ms / 60000) % 60}m`;
export const yen = (n: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 2,
  }).format(n);
export function shiftSession(s: Shift, rules: Rules): Session {
  const start = DateTime.fromISO(`${s.date}T${s.start}`);
  let end = DateTime.fromISO(`${s.date}T${s.end}`);
  if (end <= start) end = end.plus({ days: 1 });
  const b = s.breakMinutes * 60000;
  return {
    id: s.id,
    start: start.toMillis(),
    end: end.toMillis(),
    zone: zone(),
    breaks: b ? [{ start: start.toMillis(), end: start.toMillis() + b }] : [],
    rules,
    lastAction: end.toMillis(),
  };
}
export function validateShift(s: Shift) {
  if (
    !s.id ||
    !DateTime.fromISO(s.date).isValid ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) ||
    !Number.isFinite(s.breakMinutes) ||
    s.breakMinutes < 0
  )
    throw Error("Enter a full date, valid times and break minutes.");
  calculate(shiftSession(s, defaultRules));
}
export const shiftKey = (s: Shift) => `${s.date}|${s.start}|${s.end}`;
export function importShifts(
  existing: Shift[],
  incoming: Shift[],
  replace = false,
) {
  const result = [...existing];
  for (const s of incoming) {
    validateShift(s);
    if (result.some((x) => shiftKey(x) === shiftKey(s))) continue;
    const ns = shiftSession(s, defaultRules);
    const conflicts = result.filter((x) => {
      const xs = shiftSession(x, defaultRules);
      return xs.start < ns.end! && ns.start < xs.end!;
    });
    if (conflicts.length && !replace)
      throw Error("Overlapping shifts found. Choose keep existing or replace.");
    for (const c of conflicts) result.splice(result.indexOf(c), 1);
    result.push(s);
  }
  return result;
}
export function report(sessions: Session[], month: string) {
  const rows = sessions
    .filter((s) => s.end !== undefined && monthOf(s) === month)
    .map((s) => ({ session: s, ...calculate(s) }));
  return {
    rows,
    total: rows.reduce((n, r) => n + r.total, 0),
    workMs: rows.reduce((n, r) => n + r.workMs, 0),
  };
}
export function parseBackup(raw: unknown): State {
  const s = raw as State;
  if (
    !s ||
    s.version !== 1 ||
    !s.settings ||
    !Array.isArray(s.shifts) ||
    !Array.isArray(s.sessions) ||
    typeof s.settings.name !== "string" ||
    typeof s.settings.aliases !== "string" ||
    typeof s.settings.scannerUrl !== "string" ||
    !["en", "ja"].includes(s.settings.language) ||
    !["light", "dark", "system"].includes(s.settings.theme)
  )
    throw Error("Invalid backup format");
  validateRules(s.settings.rules);
  s.shifts.forEach(validateShift);
  s.sessions.forEach((x) => {
    if (!x.id || !Array.isArray(x.breaks) || !Number.isFinite(x.lastAction))
      throw Error("Invalid session");
    validateSession(x);
  });
  if (
    s.sessions.filter((x) => !x.end).length > 1 ||
    new Set(s.sessions.map((x) => x.id)).size !== s.sessions.length ||
    new Set(s.shifts.map((x) => x.id)).size !== s.shifts.length
  )
    throw Error("Duplicate IDs or multiple active sessions");
  return s;
}

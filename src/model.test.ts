import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { DateTime } from "luxon";
import {
  calculate,
  defaultRules,
  importShifts,
  initial,
  monthOf,
  parseBackup,
  report,
  type Session,
  type Shift,
} from "./model";
import { mutate, read } from "./store";
const at = (s: string) =>
  DateTime.fromISO(s, { zone: "Asia/Tokyo" }).toMillis();
const session = (start: string, end: string): Session => ({
  id: "test",
  start: at(start),
  end: at(end),
  zone: "Asia/Tokyo",
  breaks: [],
  rules: { ...defaultRules },
  lastAction: at(end),
});
describe("precise salary rules", () => {
  it.each([14, 15, 29, 30, 44, 45, 60])(
    "rounds %i night minutes once",
    (minutes) => {
      const s = session("2026-10-02T22:00", "2026-10-02T22:00");
      s.end = s.start + minutes * 60000;
      expect(calculate(s).payableNightMs / 60000).toBe(
        Math.floor(minutes / 15) * 15,
      );
    },
  );
  it("22:00 boundary and supplied examples", () => {
    expect(
      calculate(session("2026-10-02T21:00", "2026-10-02T22:20")).total,
    ).toBe(1629);
    expect(
      calculate(session("2026-10-02T22:00", "2026-10-02T22:40")).total,
    ).toBe(858);
    expect(
      calculate(session("2026-10-02T22:00", "2026-10-02T22:50")).total,
    ).toBe(1287);
    expect(
      calculate(session("2026-10-02T22:00", "2026-10-02T23:10")).total,
    ).toBe(1716);
  });
  it("05:00 boundary and overnight", () => {
    const c = calculate(session("2026-10-02T22:00", "2026-10-03T06:00"));
    expect(c.nightMs / 3600000).toBe(7);
    expect(c.regularMs / 3600000).toBe(1);
  });
  it("break crossing night boundary", () => {
    const s = session("2026-10-02T21:00", "2026-10-02T23:00");
    s.breaks = [{ start: at("2026-10-02T21:50"), end: at("2026-10-02T22:10") }];
    const c = calculate(s);
    expect(c.regularMs / 60000).toBe(50);
    expect(c.nightMs / 60000).toBe(50);
    expect(c.payableNightMs / 60000).toBe(45);
  });
  it("sums multiple night intervals before rounding", () => {
    const s = session("2026-10-02T22:00", "2026-10-02T22:40");
    s.breaks = [{ start: at("2026-10-02T22:10"), end: at("2026-10-02T22:30") }];
    expect(calculate(s).payableNightMs / 60000).toBe(15);
  });
  it("does not round regular minutes", () => {
    expect(
      calculate(session("2026-10-02T12:00", "2026-10-02T12:14")).total,
    ).toBe(280);
  });
  it("cross month attribution and closed-app rollover", () => {
    const s = session("2026-09-30T23:00", "2026-10-01T02:00");
    expect(monthOf(s)).toBe("2026-09");
    expect(report([s], "2026-10").total).toBe(0);
    expect(report([s], "2026-09").total).toBe(5148);
  });
  it("uses recorded timezone for historical month", () => {
    const s = session("2026-10-01T00:30", "2026-10-01T01:30");
    s.zone = "America/Los_Angeles";
    expect(monthOf(s)).toBe("2026-09");
  });
  it("settings do not alter completed sessions", () => {
    const s = session("2026-10-02T09:00", "2026-10-02T10:00");
    const settings = { ...defaultRules, rate: 2400 };
    expect(settings.rate).toBe(2400);
    expect(calculate(s).total).toBe(1200);
  });
  it("correction updates report totals", () => {
    const s = session("2026-10-02T09:00", "2026-10-02T10:00");
    expect(report([s], "2026-10").total).toBe(1200);
    s.end! += 3600000;
    expect(report([s], "2026-10").total).toBe(2400);
  });
  it("invalid and overlapping breaks rejected", () => {
    const s = session("2026-10-02T09:00", "2026-10-02T10:00");
    s.breaks = [
      { start: s.start, end: s.start + 2000 },
      { start: s.start + 1000, end: s.end },
    ];
    expect(() => calculate(s)).toThrow();
  });
  it("negative device clock rejected", () => {
    const s = session("2026-10-02T09:00", "2026-10-02T08:00");
    expect(() => calculate(s)).toThrow();
  });
});
describe("imports and persistence", () => {
  const shift: Shift = {
    id: "one",
    date: "2026-10-02",
    start: "21:00",
    end: "05:00",
    breakMinutes: 30,
  };
  it("deduplicates imports, detects overnight conflicts and can replace", () => {
    expect(importShifts([shift], [{ ...shift, id: "two" }])).toHaveLength(1);
    const next = {
      ...shift,
      id: "three",
      date: "2026-10-03",
      start: "04:00",
      end: "06:00",
    };
    expect(() => importShifts([shift], [next])).toThrow();
    expect(importShifts([shift], [next], true)).toEqual([next]);
  });
  it("rejects corrupt backups", () => {
    expect(() => parseBackup({ version: 2 })).toThrow();
    expect(() =>
      parseBackup({
        ...initial,
        sessions: [session("2026-10-02T09:00", "2026-10-02T08:00")],
      }),
    ).toThrow();
  });
  beforeEach(async () => {
    await mutate(() => structuredClone(initial));
  });
  it("connects existing unconfigured installations without losing records", async () => {
    const s = session("2026-10-02T09:00", "2026-10-02T10:00");
    await mutate((st) => ({
      ...st,
      settings: { ...st.settings, scannerUrl: "" },
      shifts: [shift],
      sessions: [s],
    }));
    const recovered = await read();
    expect(recovered.settings.scannerUrl).toBe(initial.settings.scannerUrl);
    expect(recovered.shifts).toEqual([shift]);
    expect(recovered.sessions).toEqual([s]);
  });
  it("preserves a custom scanner endpoint", async () => {
    await mutate((st) => ({
      ...st,
      settings: { ...st.settings, scannerUrl: "https://custom.example" },
    }));
    expect((await read()).settings.scannerUrl).toBe("https://custom.example");
  });
  it("recovers active timer after reload from saved timestamps", async () => {
    const s = session("2026-10-02T09:00", "2026-10-02T10:00");
    delete s.end;
    s.lastAction = s.start;
    await mutate((st) => ({ ...st, sessions: [s] }));
    const loaded = await read();
    expect(calculate(loaded.sessions[0], s.start + 3600000).workMs).toBe(
      3600000,
    );
  });
  it("serializes simultaneous active starts across transactions", async () => {
    const start = () =>
      mutate((st) => {
        if (st.sessions.some((s) => !s.end)) throw Error("Active");
        const s = session("2026-10-02T09:00", "2026-10-02T10:00");
        delete s.end;
        return { ...st, sessions: [s] };
      });
    const results = await Promise.allSettled([start(), start()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await read()).sessions).toHaveLength(1);
  });
});

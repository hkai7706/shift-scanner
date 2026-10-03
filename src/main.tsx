import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DateTime } from "luxon";
import {
  LayoutDashboard,
  CalendarDays,
  ScanLine,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  Zap,
  ArrowUpRight,
  Plus,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import {
  calculate,
  defaultRules,
  duration,
  importShifts,
  initial,
  monthOf,
  normalize,
  parseBackup,
  report,
  shiftSession,
  validateRules,
  validateSession,
  validateShift,
  yen,
  zone,
  type Session,
  type Shift,
  type State,
} from "./model";
import { read, mutate, channel } from "./store";
import { scannerRequest, type ScanResponse } from "./scanner";
import { imageToScanData } from "./images";
import "./style.css";
const uuid = () => crypto.randomUUID();
const local = (n: number, z = zone()) =>
  DateTime.fromMillis(n, { zone: z }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
const time = (n: number, z = zone()) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: z,
  }).format(n);
function download(name: string, data: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function App() {
  const [state, setState] = useState<State>(initial),
    [loaded, setLoaded] = useState(false),
    [page, setPage] = useState("Dashboard"),
    [now, setNow] = useState(Date.now()),
    [message, setMessage] = useState(""),
    [month, setMonth] = useState(DateTime.local().toFormat("yyyy-MM")),
    [agenda, setAgenda] = useState(false),
    [editShift, setEditShift] = useState<Shift | null>(null),
    [editSession, setEditSession] = useState<Session | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [undo, setUndo] = useState<Shift[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [preview, setPreview] = useState(""),
    [scanning, setScanning] = useState(false),
    [scanRows, setScanRows] = useState<
      (Shift & {
        matchedName: string;
        confidence: number;
        uncertainty: string;
        confirmed: boolean;
        selected: boolean;
      })[]
    >([]),
    [token, setToken] = useState(""),
    [conflict, setConflict] = useState("keep"),
    [settings, setSettings] = useState(initial.settings),
    [restoreMode, setRestoreMode] = useState("merge");
  useEffect(() => {
    if (page === "Settings") setSettings(state.settings);
  }, [page]);
  useEffect(() => {
    if (!editShift && !editSession) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>(".modal");
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button,input,select,[tabindex="0"]',
        ) ?? [],
      ).filter((x) => !x.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditShift(null);
        setEditSession(null);
      }
      if (event.key === "Tab") {
        const list = focusables(),
          first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [!!editShift, !!editSession]);
  const clockBaseline = useRef({ wall: Date.now(), mono: performance.now() });
  const [clockWarning, setClockWarning] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const b = clockBaseline.current;
      if (Math.abs(Date.now() - b.wall - (performance.now() - b.mono)) > 120000)
        setClockWarning(true);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const ja = state.settings.language === "ja";
  const t = (en: string, jp: string) => (ja ? jp : en);
  useEffect(() => {
    read()
      .then((s) => {
        setState(s);
        setSettings(s.settings);
        setLoaded(true);
      })
      .catch((e) => setMessage(e.message));
    const refresh = () => read().then(setState);
    if (channel) channel.onmessage = refresh;
    const id = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      if (channel) channel.onmessage = null;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      state.settings.theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : state.settings.theme;
    document.documentElement.lang = state.settings.language;
  }, [state.settings]);
  useEffect(() => {
    if (!files.length) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(files[0]);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [files]);
  async function update(fn: (s: State) => State) {
    try {
      const next = await mutate(fn);
      setState(next);
      return next;
    } catch (e) {
      setMessage((e as Error).message);
      return null;
    }
  }
  const active = state.sessions.find((s) => !s.end),
    currentMonth = DateTime.fromMillis(now).toFormat("yyyy-MM"),
    monthly = report(state.sessions, currentMonth),
    rep = report(state.sessions, month),
    onBreak = !!active?.breaks.at(-1) && !active.breaks.at(-1)?.end;
  let live: ReturnType<typeof calculate> | null = null;
  try {
    if (active) live = calculate(active, now);
  } catch {
    /* correction UI remains usable */
  }
  const provisional =
    active && monthOf(active) === currentMonth ? (live?.total ?? 0) : 0;
  const future = state.shifts
    .filter((s) => shiftSession(s, state.settings.rules).start >= now)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const planned = future.reduce(
    (n, s) => n + calculate(shiftSession(s, state.settings.rules)).total,
    0,
  );
  async function timer(action: string, shiftId?: string) {
    if (clockWarning) {
      setMessage(
        "Device clock changed. Inspect and save the active session before continuing.",
      );
      if (active) setEditSession(active);
      return;
    }
    const at = Date.now();
    const next = await update((s) => {
      const a = s.sessions.find((x) => !x.end);
      if (action === "start") {
        if (a) throw Error("A shift is already running in another tab.");
        return {
          ...s,
          sessions: [
            ...s.sessions,
            {
              id: uuid(),
              start: at,
              zone: zone(),
              breaks: [],
              rules: structuredClone(s.settings.rules),
              shiftId,
              lastAction: at,
            },
          ],
        };
      }
      if (!a) throw Error("No active session");
      if (at < a.lastAction || at - a.start > 36 * 3600000)
        throw Error(
          "Suspicious device clock or long shift. Open the session and correct timestamps before continuing.",
        );
      const copy = structuredClone(a);
      const b = copy.breaks.at(-1);
      if (action === "break") {
        if (b && !b.end) throw Error("Already on break");
        copy.breaks.push({ start: at });
      }
      if (action === "resume") {
        if (!b || b.end) throw Error("Not on break");
        b.end = at;
      }
      if (action === "end") {
        if (b && !b.end) b.end = at;
        copy.end = at;
      }
      copy.lastAction = at;
      validateSession(copy, at);
      return {
        ...s,
        sessions: s.sessions.map((x) => (x.id === a.id ? copy : x)),
      };
    });
    if (action === "end" && next)
      setEditSession(next.sessions.find((s) => s.end === at) ?? null);
  }
  function newShift() {
    setEditShift({
      id: uuid(),
      date: DateTime.local().toISODate()!,
      start: "09:00",
      end: "17:00",
      breakMinutes: 0,
    });
  }
  function moveMonth(n: number) {
    setMonth(
      DateTime.fromISO(month + "-01")
        .plus({ months: n })
        .toFormat("yyyy-MM"),
    );
  }
  async function remove(ids: string[]) {
    if (
      !confirm(
        t(
          "Delete selected shifts? You can undo this deletion.",
          "選択したシフトを削除しますか？元に戻せます。",
        ),
      )
    )
      return;
    const deleted = state.shifts.filter((s) => ids.includes(s.id));
    if (
      await update((s) => ({
        ...s,
        shifts: s.shifts.filter((x) => !ids.includes(x.id)),
      }))
    ) {
      setUndo(deleted);
      setSelected([]);
      setEditShift(null);
    }
  }
  async function scan() {
    if (!state.settings.scannerUrl) {
      setMessage(
        t(
          "Scanner unavailable. Configure the secure endpoint in Settings. Manual entry remains available.",
          "スキャナー未設定です。設定で安全なエンドポイントを指定してください。手動入力は利用できます。",
        ),
      );
      return;
    }
    if (!files.length) return;
    setScanning(true);
    setScanRows([]);
    try {
      await scannerRequest<{ ready: boolean }>(
        state.settings.scannerUrl,
        token,
        undefined,
        state.settings.language,
      );
      const pages: { filename: string; page: number; data: string }[] = [];
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024)
          throw Error("Maximum source file size is 20 MB");
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).href;
          const pdf = await pdfjs.getDocument({
            data: await file.arrayBuffer(),
          }).promise;
          if (pdf.numPages > 30) throw Error("Maximum 30 PDF pages per file");
          for (let i = 1; i <= pdf.numPages; i++) {
            const p = await pdf.getPage(i),
              v = p.getViewport({
                scale: Math.min(2, 1800 / p.getViewport({ scale: 1 }).width),
              }),
              c = document.createElement("canvas");
            c.width = v.width;
            c.height = v.height;
            await p.render({ canvasContext: c.getContext("2d")!, viewport: v })
              .promise;
            pages.push({
              filename: file.name,
              page: i,
              data: c.toDataURL("image/jpeg", 0.85),
            });
          }
          await pdf.destroy();
        } else if (
          file.type.startsWith("image/") ||
          /\.(png|jpe?g|webp|heic|heif|gif)$/i.test(file.name)
        ) {
          pages.push({
            filename: file.name,
            page: 1,
            data: await imageToScanData(file, state.settings.language),
          });
        } else throw Error("Use images or PDF files");
      }
      const results: typeof scanRows = [];
      for (const p of pages) {
        const result = await scannerRequest<ScanResponse>(
          state.settings.scannerUrl,
          token,
          {
            names: [
              state.settings.name,
              ...state.settings.aliases
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ],
            page: p,
          },
          state.settings.language,
        );
        if (!Array.isArray(result.shifts))
          throw Error("Invalid scanner response");
        for (const row of result.shifts) {
          const match = [
            state.settings.name,
            ...state.settings.aliases.split(","),
          ].some((n) => normalize(n) === normalize(row.matchedName || ""));
          results.push({
            id: uuid(),
            date: row.date || "",
            start: row.start || "",
            end: row.end || "",
            breakMinutes: row.breakMinutes ?? 0,
            source: p.filename,
            page: p.page,
            matchedName: row.matchedName || "",
            confidence: row.confidence ?? 0,
            uncertainty: [
              row.uncertainty,
              !match ? "Name match requires review" : "",
              row.breakMinutes == null
                ? "No explicit break provided; review 0 minutes"
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
            confirmed: false,
            selected: match,
          });
        }
      }
      setScanRows(results);
      setMessage(
        results.length
          ? `${results.length} candidate shifts. Review every row before import.`
          : "No shifts found for your name. Try a sharper image or enter shifts manually.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setScanning(false);
    }
  }
  const nav = [
    { name: "Dashboard", jp: "ホーム", icon: LayoutDashboard },
    { name: "Calendar", jp: "カレンダー", icon: CalendarDays },
    { name: "Scan", jp: "スキャン", icon: ScanLine },
    { name: "Monthly Reports", jp: "月次レポート", icon: ChartNoAxesCombined },
    { name: "Settings", jp: "設定", icon: SettingsIcon },
  ];
  const monthControls = (
    <div className="month-controls">
      <button aria-label="Previous month" onClick={() => moveMonth(-1)}>
        <ChevronLeft size={18} />
      </button>
      <input
        aria-label="Report month"
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <button aria-label="Next month" onClick={() => moveMonth(1)}>
        <ChevronRight size={18} />
      </button>
      <button onClick={() => setMonth(currentMonth)}>
        {t("Today", "今日")}
      </button>
    </div>
  );
  function sessionList(sessions: Session[]) {
    return sessions.length ? (
      <div className="session-list">
        {sessions.map((s) => {
          const c = calculate(s);
          return (
            <button
              className="session-row"
              key={s.id}
              onClick={() => setEditSession(s)}
            >
              <div className="date-badge">
                {DateTime.fromMillis(s.start, { zone: s.zone }).toFormat("dd")}
                <small>
                  {DateTime.fromMillis(s.start, { zone: s.zone }).toFormat(
                    "MMM",
                  )}
                </small>
              </div>
              <div>
                <strong>
                  {time(s.start, s.zone)} – {time(s.end!, s.zone)}
                </strong>
                <small>
                  {duration(c.workMs)} · {t("Completed", "完了")}
                </small>
              </div>
              <strong className="row-pay">
                {yen(c.total)} <ArrowUpRight size={16} />
              </strong>
            </button>
          );
        })}
      </div>
    ) : (
      <div className="empty">
        <Clock size={28} />
        <p>
          {t(
            "Your first shift starts a new story.",
            "最初のシフトを記録しましょう。",
          )}
        </p>
        <small>
          {t(
            "Completed sessions will appear here.",
            "完了した勤務がここに表示されます。",
          )}
        </small>
      </div>
    );
  }
  if (!loaded) return <main className="loading">Opening your workspace…</main>;
  return (
    <div className="app">
      <aside>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span>
            <Zap fill="currentColor" />
          </span>
          shiftly<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">
          {t("YOUR WORKSPACE", "ワークスペース")}
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.name}
              className={page === n.name ? "nav-active" : ""}
              onClick={() => {
                setPage(n.name);
                setMessage("");
              }}
            >
              <n.icon size={20} />
              <span>{t(n.name, n.jp)}</span>
              {n.name === "Scan" && <small>AI</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <strong>{t("Personal by design", "あなた専用")}</strong>
          <p>
            {t(
              "Your time. Your data. Stored on this device.",
              "時間とデータはこの端末に保存されます。",
            )}
          </p>
          <div className="profile">
            <span>ゼ</span>
            <div>
              <strong>{state.settings.name}</strong>
              <small>{t("Personal workspace", "個人ワークスペース")}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header>
          <span>
            <span className="online-dot" />
            {t("LOCAL-FIRST WORKSPACE", "ローカル保存")}
          </span>
          <div>
            <button
              className="text-button"
              onClick={() =>
                update((s) => ({
                  ...s,
                  settings: { ...s.settings, language: ja ? "en" : "ja" },
                }))
              }
            >
              {ja ? "English" : "日本語"}
            </button>
            <span className="header-date">
              {DateTime.fromMillis(now)
                .setLocale(ja ? "ja" : "en")
                .toFormat("ccc, MMM d")}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {t("MAKE EVERY HOUR COUNT", "時間を大切に")}
              </p>
              <h1>
                {page === "Dashboard"
                  ? t(
                      "A little clarity for your workday.",
                      "今日の勤務を、すっきり。",
                    )
                  : t(page, nav.find((n) => n.name === page)!.jp)}
              </h1>
              <p>
                {page === "Dashboard"
                  ? t(
                      "Your shifts, time, and earnings. All in one calm place.",
                      "シフト、勤務時間、給与をひとつに。",
                    )
                  : t("Your time, accounted for.", "勤務時間を正確に記録。")}
              </p>
            </div>
            {page !== "Settings" && (
              <button className="primary" onClick={newShift}>
                <Plus size={18} />
                {t("Add shift", "シフト追加")}
              </button>
            )}
          </div>
          {clockWarning && (
            <div className="notice" role="alert">
              {t(
                "Device clock changed. Review the active session before continuing.",
                "端末の時計が変更されました。勤務記録を確認してください。",
              )}
              <button
                onClick={() => {
                  if (active) setEditSession(active);
                  else {
                    clockBaseline.current = {
                      wall: Date.now(),
                      mono: performance.now(),
                    };
                    setClockWarning(false);
                  }
                }}
              >
                {t("Review", "確認")}
              </button>
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              {message}
              <button aria-label="Dismiss" onClick={() => setMessage("")}>
                ×
              </button>
            </div>
          )}
          {undo.length > 0 && (
            <div className="notice">
              {t("Shifts deleted.", "シフトを削除しました。")}
              <button
                onClick={async () => {
                  if (
                    await update((s) => ({
                      ...s,
                      shifts: importShifts(s.shifts, undo),
                    }))
                  )
                    setUndo([]);
                }}
              >
                {t("Undo", "元に戻す")}
              </button>
            </div>
          )}
          {page === "Dashboard" && (
            <>
              <section className="earnings-card">
                <div>
                  <div className="eyebrow">
                    {t("EARNED THIS MONTH", "今月の収入")}{" "}
                    <span>
                      {DateTime.fromMillis(now)
                        .setLocale(ja ? "ja" : "en")
                        .toFormat("MMMM yyyy")}
                    </span>
                  </div>
                  <div className="big-money">
                    {yen(monthly.total + provisional)}
                  </div>
                  <p>
                    {t(
                      "Estimated earnings · based on your pay rules",
                      "設定した給与ルールに基づく推定額",
                    )}
                  </p>
                  <div className="earnings-split">
                    <span>
                      {t("Completed", "完了")}{" "}
                      <strong>{yen(monthly.total)}</strong>
                    </span>
                    <span>
                      {t("Live estimate", "勤務中の推定額")}{" "}
                      <strong>{yen(provisional)}</strong>
                    </span>
                  </div>
                </div>
                <div className="earnings-stats">
                  <div>
                    <Clock size={19} />
                    <strong>
                      {duration(
                        monthly.workMs +
                          (active && monthOf(active) === currentMonth
                            ? (live?.workMs ?? 0)
                            : 0),
                      )}
                    </strong>
                    <span>{t("time worked", "勤務時間")}</span>
                  </div>
                  <div>
                    <CalendarDays size={19} />
                    <strong>
                      {monthly.rows.length.toString().padStart(2, "0")}
                    </strong>
                    <span>{t("completed shifts", "完了した勤務")}</span>
                  </div>
                  <button
                    onClick={() => {
                      setPage("Monthly Reports");
                      setMonth(currentMonth);
                    }}
                  >
                    {t("View monthly report", "月次レポートを見る")}{" "}
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </section>
              <div className="dashboard-grid">
                <section className="card timer-card">
                  <div className="section-title">
                    <h2>
                      {t("Your shift, in real time", "勤務をリアルタイムで")}
                    </h2>
                    <span className={"pill " + (active ? "working" : "")}>
                      {active
                        ? onBreak
                          ? t("On break", "休憩中")
                          : t("Working", "勤務中")
                        : t("Ready when you are", "開始できます")}
                    </span>
                  </div>
                  <div className="timer-number">
                    {active ? duration(live?.workMs ?? 0) : "0h 00m"}
                  </div>
                  <p className="center muted">
                    {active
                      ? `${t("Started", "開始")} ${time(active.start, active.zone)} · ${active.zone}`
                      : t(
                          "Clock in and let us take care of the math.",
                          "勤務を開始すると給与を自動計算します。",
                        )}
                  </p>
                  {active && (
                    <>
                      <div className="timer-metrics">
                        {[
                          [t("Elapsed", "経過"), duration(now - active.start)],
                          [t("Break", "休憩"), duration(live?.breakMs ?? 0)],
                          [
                            t("Regular", "通常"),
                            duration(live?.regularMs ?? 0),
                          ],
                          [
                            t("Actual night", "実際の深夜"),
                            duration(live?.nightMs ?? 0),
                          ],
                          [
                            t("Payable night", "支払対象の深夜"),
                            duration(live?.payableNightMs ?? 0),
                          ],
                          [t("Estimate", "推定"), yen(live?.total ?? 0)],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <small>{k}</small>
                            <strong>{v}</strong>
                          </div>
                        ))}
                      </div>
                      {(!live ||
                        now < active.lastAction ||
                        now - active.start > 36 * 3600000) && (
                        <p role="alert">
                          {t(
                            "Clock or duration warning. Please inspect and correct this session.",
                            "時計または勤務時間を確認・修正してください。",
                          )}
                        </p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setEditSession(active)}
                      >
                        {t(
                          "Correct session / link shift",
                          "勤務の修正・シフト連携",
                        )}
                      </button>
                    </>
                  )}
                  <div className="timer-actions">
                    {active ? (
                      <>
                        <button
                          onClick={() => timer(onBreak ? "resume" : "break")}
                        >
                          {onBreak
                            ? t("Resume Shift", "勤務再開")
                            : t("Start Break", "休憩開始")}
                        </button>
                        <button
                          className="primary"
                          onClick={() => timer("end")}
                        >
                          {t("End Shift", "勤務終了")}
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary"
                        onClick={() => timer("start")}
                      >
                        <Zap size={18} />
                        {t("Start Shift", "勤務開始")}
                      </button>
                    )}
                  </div>
                  <div className="card-foot">
                    <ShieldCheck size={15} />
                    {t(
                      "Saved automatically. Safe to close this tab.",
                      "自動保存。タブを閉じても記録は続きます。",
                    )}
                  </div>
                </section>
                <section className="card next-card">
                  <div className="section-title">
                    <h2>{t("Up next", "次の予定")}</h2>
                    <CalendarDays size={20} />
                  </div>
                  {future[0] ? (
                    <>
                      <p className="eyebrow">
                        {DateTime.fromISO(future[0].date)
                          .setLocale(ja ? "ja" : "en")
                          .toFormat("cccc, MMMM d")}
                      </p>
                      <h3>
                        {future[0].start} — {future[0].end}
                        {future[0].end <= future[0].start && (
                          <small> (+1 day)</small>
                        )}
                      </h3>
                      <p className="muted">
                        {duration(
                          calculate(
                            shiftSession(future[0], state.settings.rules),
                          ).workMs,
                        )}{" "}
                        ·{" "}
                        {yen(
                          calculate(
                            shiftSession(future[0], state.settings.rules),
                          ).total,
                        )}{" "}
                        {t("planned", "予定")}
                      </p>
                      <button
                        onClick={() => timer("start", future[0].id)}
                        disabled={!!active}
                      >
                        {t("Start this shift", "この勤務を開始")}
                      </button>
                    </>
                  ) : (
                    <div className="empty">
                      <CalendarDays size={32} />
                      <p>
                        {t(
                          "A clear calendar, a fresh start.",
                          "予定を追加しましょう。",
                        )}
                      </p>
                      <button onClick={newShift}>
                        {t("Plan your next shift", "次のシフトを予定")}
                      </button>
                    </div>
                  )}
                  <div className="planned-total">
                    <small>
                      {t("Future planned earnings", "今後の予定収入")}
                    </small>
                    <strong>{yen(planned)}</strong>
                    <p>
                      {t(
                        "An outlook, separate from money earned.",
                        "実際の収入とは別の予定額です。",
                      )}
                    </p>
                  </div>
                </section>
              </div>
              <div className="dashboard-grid bottom-grid">
                <section className="card">
                  <div className="section-title">
                    <h2>{t("Recently wrapped up", "最近の勤務")}</h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("Monthly Reports")}
                    >
                      {t("View all", "すべて見る")} ↗
                    </button>
                  </div>
                  {sessionList(
                    [...state.sessions]
                      .filter((s) => s.end)
                      .sort((a, b) => b.start - a.start)
                      .slice(0, 4),
                  )}
                </section>
                <section className="scan-promo">
                  <ScanLine size={30} />
                  <p className="eyebrow">
                    {t("LESS TYPING. MORE LIVING.", "入力の手間を減らそう。")}
                  </p>
                  <h2>
                    {t(
                      "From shift sheet\nto a clear schedule.",
                      "シフト表から\nカレンダーへ。",
                    )}
                  </h2>
                  <p>
                    {t(
                      "Upload your schedule. Review your shifts. Make them yours.",
                      "シフト表をアップロード、確認して取り込み。",
                    )}
                  </p>
                  <button onClick={() => setPage("Scan")}>
                    {t("Scan a shift sheet", "シフト表をスキャン")}{" "}
                    <ArrowUpRight size={18} />
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "Calendar" && (
            <section className="card">
              {" "}
              <div className="section-title">
                {monthControls}
                <button onClick={() => setAgenda(!agenda)}>
                  {agenda
                    ? t("Month view", "月表示")
                    : t("Agenda view", "一覧表示")}
                </button>
              </div>
              <div className="legend">
                <span>● {t("Planned", "予定")}</span>
                <span className="green">● {t("Completed", "完了")}</span>
                <span className="orange">● {t("Active", "勤務中")}</span>
              </div>
              {!agenda ? (
                <div className="calendar">
                  {(ja
                    ? ["日", "月", "火", "水", "木", "金", "土"]
                    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                  ).map((d) => (
                    <div className="weekday" key={d}>
                      {d}
                    </div>
                  ))}
                  {Array.from({ length: 42 }, (_, i) => {
                    const first = DateTime.fromISO(month + "-01"),
                      d = first
                        .minus({ days: first.weekday % 7 })
                        .plus({ days: i }),
                      date = d.toISODate()!;
                    return (
                      <div
                        className={
                          "day " +
                          (d.toFormat("yyyy-MM") !== month ? "outside" : "") +
                          (date === DateTime.local().toISODate()
                            ? " today"
                            : "")
                        }
                        key={date}
                      >
                        <button
                          className="day-number"
                          onClick={() =>
                            setEditShift({
                              id: uuid(),
                              date,
                              start: "09:00",
                              end: "17:00",
                              breakMinutes: 0,
                            })
                          }
                        >
                          {d.day}
                        </button>
                        {state.shifts
                          .filter((s) => s.date === date)
                          .map((s) => {
                            const linked = state.sessions.find(
                              (x) => x.shiftId === s.id,
                            );
                            return (
                              <button
                                className={
                                  "calendar-shift " +
                                  (linked
                                    ? linked.end
                                      ? "complete"
                                      : "active"
                                    : "")
                                }
                                key={s.id}
                                onClick={() => setEditShift(s)}
                              >
                                {s.start}–{s.end}
                                {s.end <= s.start ? " +1" : ""}
                                <small>
                                  {yen(
                                    calculate(
                                      shiftSession(s, state.settings.rules),
                                    ).total,
                                  )}
                                </small>
                              </button>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="session-list">
                  {state.shifts
                    .filter((s) => s.date.startsWith(month))
                    .sort((a, b) =>
                      (a.date + a.start).localeCompare(b.date + b.start),
                    )
                    .map((s) => (
                      <div className="agenda-row" key={s.id}>
                        <input
                          aria-label="Select shift"
                          type="checkbox"
                          checked={selected.includes(s.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, s.id]
                                : selected.filter((x) => x !== s.id),
                            )
                          }
                        />
                        <button onClick={() => setEditShift(s)}>
                          <strong>
                            {s.date} · {s.start}–{s.end}
                            {s.end <= s.start ? " (+1 day)" : ""}
                          </strong>
                          <small>
                            {duration(
                              calculate(shiftSession(s, state.settings.rules))
                                .workMs,
                            )}{" "}
                            ·{" "}
                            {yen(
                              calculate(shiftSession(s, state.settings.rules))
                                .total,
                            )}{" "}
                            {t("estimated", "推定")}
                          </small>
                        </button>
                      </div>
                    ))}
                  {!state.shifts.some((s) => s.date.startsWith(month)) && (
                    <div className="empty">
                      {t(
                        "No shifts planned for this month.",
                        "今月のシフトはありません。",
                      )}
                    </div>
                  )}
                  <button
                    disabled={!selected.length}
                    onClick={() => remove(selected)}
                  >
                    <Trash2 size={16} />
                    {t("Delete selected", "選択したシフトを削除")}
                  </button>
                </div>
              )}
            </section>
          )}
          {page === "Monthly Reports" && (
            <>
              <section className="card">
                <div className="section-title">
                  {monthControls}
                  <div className="button-group">
                    <button
                      onClick={() => {
                        const rows = [
                          [
                            "Date",
                            "Start",
                            "End",
                            "Timezone",
                            "Break minutes",
                            "Work minutes",
                            "Regular pay",
                            "Night pay",
                            "Total",
                          ],
                          ...rep.rows.map((r) => [
                            DateTime.fromMillis(r.session.start, {
                              zone: r.session.zone,
                            }).toISODate(),
                            local(r.session.start, r.session.zone),
                            local(r.session.end!, r.session.zone),
                            r.session.zone,
                            r.breakMs / 60000,
                            r.workMs / 60000,
                            r.regularPay,
                            r.nightPay,
                            r.total,
                          ]),
                        ];
                        download(
                          `shiftly-${month}.csv`,
                          "\ufeff" +
                            rows
                              .map((row) =>
                                row
                                  .map(
                                    (x) =>
                                      '"' +
                                      String(x).replaceAll('"', '""') +
                                      '"',
                                  )
                                  .join(","),
                              )
                              .join("\r\n"),
                          "text/csv;charset=utf-8",
                        );
                      }}
                    >
                      <Download size={16} />
                      CSV
                    </button>
                    <button onClick={() => window.print()}>
                      {t("Print", "印刷")}
                    </button>
                  </div>
                </div>
                <h2 className="report-month">
                  {DateTime.fromISO(month + "-01")
                    .setLocale(ja ? "ja" : "en")
                    .toFormat("MMMM yyyy")}
                </h2>
                <p className="eyebrow">
                  {month === currentMonth
                    ? t("IN PROGRESS", "集計中")
                    : t("MONTHLY SUMMARY", "月次集計")}
                </p>
                <div className="report-total">
                  {yen(rep.total)}
                  <small>
                    {t(
                      "Completed sessions only · estimated salary",
                      "完了した勤務のみ・推定給与",
                    )}
                  </small>
                </div>
                <div className="report-stats">
                  {[
                    [t("Working time", "勤務時間"), duration(rep.workMs)],
                    [
                      t("Completed shifts", "完了勤務"),
                      String(rep.rows.length),
                    ],
                    [
                      t("Regular time", "通常時間"),
                      duration(rep.rows.reduce((n, r) => n + r.regularMs, 0)),
                    ],
                    [
                      t("Regular earnings", "通常給与"),
                      yen(rep.rows.reduce((n, r) => n + r.regularPay, 0)),
                    ],
                    [
                      t("Actual night", "実際の深夜"),
                      duration(rep.rows.reduce((n, r) => n + r.nightMs, 0)),
                    ],
                    [
                      t("Payable night", "対象深夜時間"),
                      duration(
                        rep.rows.reduce((n, r) => n + r.payableNightMs, 0),
                      ),
                    ],
                    [
                      t("Night earnings", "深夜給与"),
                      yen(rep.rows.reduce((n, r) => n + r.nightPay, 0)),
                    ],
                    [
                      t("Unpaid breaks", "無給休憩"),
                      duration(rep.rows.reduce((n, r) => n + r.breakMs, 0)),
                    ],
                    [
                      t("Average / shift", "平均給与"),
                      yen(rep.rows.length ? rep.total / rep.rows.length : 0),
                    ],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{val}</strong>
                    </div>
                  ))}
                </div>
                {active && monthOf(active) === month && (
                  <p className="notice">
                    {t(
                      "Active session estimate, excluded above:",
                      "勤務中の推定額（上記集計から除外）：",
                    )}{" "}
                    {yen(live?.total ?? 0)}
                  </p>
                )}
                <p className="muted">
                  {t(
                    "Sessions belong to the month of their start date in the recorded timezone, including overnight and cross-month work. Saved pay rules preserve historical estimates.",
                    "夜勤・月をまたぐ勤務も、記録されたタイムゾーンの開始日の月に集計します。保存された給与ルールで過去の推定額を保持します。",
                  )}
                </p>
              </section>
              <section className="card">
                <h2>{t("Daily breakdown", "日別明細")}</h2>
                {rep.rows.length ? (
                  <>
                    <div
                      className="bar-chart"
                      aria-label="Daily earnings chart"
                    >
                      {Array.from(
                        {
                          length: DateTime.fromISO(month + "-01").daysInMonth!,
                        },
                        (_, i) => {
                          const total = rep.rows
                              .filter(
                                (r) =>
                                  DateTime.fromMillis(r.session.start, {
                                    zone: r.session.zone,
                                  }).day ===
                                  i + 1,
                              )
                              .reduce((n, r) => n + r.total, 0),
                            max = Math.max(
                              1,
                              ...rep.rows.map((r) =>
                                rep.rows
                                  .filter(
                                    (x) =>
                                      DateTime.fromMillis(x.session.start, {
                                        zone: x.session.zone,
                                      }).day ===
                                      DateTime.fromMillis(r.session.start, {
                                        zone: r.session.zone,
                                      }).day,
                                  )
                                  .reduce((n, x) => n + x.total, 0),
                              ),
                            );
                          return (
                            <div key={i} title={`${i + 1}: ${yen(total)}`}>
                              <span
                                style={{ height: `${(total / max) * 85}%` }}
                              />
                              <small>{(i + 1) % 5 === 0 ? i + 1 : ""}</small>
                            </div>
                          );
                        },
                      )}
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {[
                              t("Date / shift", "日付・勤務"),
                              t("Break", "休憩"),
                              t("Working", "勤務"),
                              t("Regular pay", "通常給与"),
                              t("Night pay", "深夜給与"),
                              t("Total", "合計"),
                            ].map((x) => (
                              <th key={x}>{x}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rep.rows.map((r) => (
                            <tr key={r.session.id}>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => setEditSession(r.session)}
                                >
                                  {DateTime.fromMillis(r.session.start, {
                                    zone: r.session.zone,
                                  }).toFormat("MMM dd")}
                                  <small>
                                    {time(r.session.start, r.session.zone)} –{" "}
                                    {DateTime.fromMillis(r.session.end!, {
                                      zone: r.session.zone,
                                    }).toFormat("MMM dd")}{" "}
                                    {time(r.session.end!, r.session.zone)}
                                  </small>
                                </button>
                              </td>
                              <td>{duration(r.breakMs)}</td>
                              <td>{duration(r.workMs)}</td>
                              <td>{yen(r.regularPay)}</td>
                              <td>{yen(r.nightPay)}</td>
                              <td>
                                <strong>{yen(r.total)}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    {t(
                      "No completed sessions this month. Start a shift from the dashboard.",
                      "今月の勤務記録はありません。ホームから勤務を開始してください。",
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {page === "Scan" && (
            <>
              <section className="card">
                <div className="upload-area">
                  <ScanLine size={38} />
                  <h2>
                    {t(
                      "Turn your shift sheet into a schedule",
                      "シフト表を予定に変換",
                    )}
                  </h2>
                  <p>
                    {t(
                      "Photos, screenshots, or multi-page PDFs. Multiple files welcome.",
                      "写真、スクリーンショット、複数ページのPDFに対応。",
                    )}
                  </p>
                  <input
                    aria-label="Upload shift sheets"
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                </div>
                <div className="privacy-note">
                  <ShieldCheck size={19} />
                  <p>
                    {t(
                      "Starting a scan sends each image and every PDF page to your configured scanner and its AI provider. Files are processed in memory and not saved by this app. Verify the provider’s retention policy. Only confirmed personal shifts are stored.",
                      "スキャン開始時に画像・PDF全ページが設定されたサービスとAI提供者へ送信されます。このアプリはファイルを保存しません。提供者の保持方針を確認してください。確認した自分のシフトのみ保存します。",
                    )}
                  </p>
                </div>
                <label>
                  {t(
                    "Scanner access token (memory only)",
                    "アクセス・トークン（メモリのみ）",
                  )}
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <div className="button-group">
                  <button
                    disabled={scanning}
                    onClick={async () => {
                      setScanning(true);
                      try {
                        await scannerRequest<{ ready: boolean }>(
                          state.settings.scannerUrl,
                          token,
                          undefined,
                          state.settings.language,
                        );
                        setMessage(
                          t(
                            "Connected. Scanner token accepted. No files were sent.",
                            "接続成功。スキャナーのトークンを確認しました。ファイルは送信していません。",
                          ),
                        );
                      } catch (e) {
                        setMessage((e as Error).message);
                      } finally {
                        setScanning(false);
                      }
                    }}
                  >
                    {t("Test connection", "接続をテスト")}
                  </button>
                  <button
                    className="primary"
                    disabled={!files.length || scanning}
                    onClick={scan}
                  >
                    {scanning
                      ? t("Scanning every page…", "全ページをスキャン中…")
                      : t("Scan files", "ファイルをスキャン")}
                  </button>
                  <button
                    onClick={() => {
                      setFiles([]);
                      setScanRows([]);
                      setToken("");
                    }}
                  >
                    {t(
                      "Delete uploaded sources",
                      "アップロードしたファイルを削除",
                    )}
                  </button>
                </div>
                {files.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      URL.revokeObjectURL(preview);
                      setPreview(URL.createObjectURL(f));
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </section>
              {files.length > 0 && (
                <div className="scan-review">
                  <section className="card source-preview">
                    {preview &&
                      (files.find((f) => f.type === "application/pdf") &&
                      preview.endsWith("pdf") ? (
                        <iframe title="Source document" src={preview} />
                      ) : files.some((f) => f.type === "application/pdf") ? (
                        <object
                          aria-label="Source preview"
                          data={preview}
                          width="100%"
                          height="550"
                        >
                          <a href={preview} target="_blank">
                            Open source preview
                          </a>
                        </object>
                      ) : (
                        <img src={preview} alt="Uploaded shift sheet" />
                      ))}
                  </section>
                  <section className="card">
                    <h2>
                      {t("Review extracted shifts", "抽出したシフトを確認")}
                    </h2>
                    {scanRows.map((row, i) => (
                      <div className="scan-row" key={row.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) =>
                              setScanRows((a) =>
                                a.map((x, j) =>
                                  j === i
                                    ? { ...x, selected: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                          {row.source} · page {row.page}
                        </label>
                        <p>
                          {row.matchedName} · {Math.round(row.confidence * 100)}
                          % <span className="warning">{row.uncertainty}</span>
                        </p>
                        <div className="form-grid">
                          {(["date", "start", "end"] as const).map((k) => (
                            <label key={k}>
                              {k === "date"
                                ? t("Date", "日付")
                                : k === "start"
                                  ? t("Start", "開始")
                                  : t("End", "終了")}
                              <input
                                type={k === "date" ? "date" : "time"}
                                value={row[k]}
                                onChange={(e) =>
                                  setScanRows((a) =>
                                    a.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            [k]: e.target.value,
                                            confirmed: false,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                          ))}
                          <label>
                            {t("Break minutes", "休憩（分）")}
                            <input
                              type="number"
                              min="0"
                              value={row.breakMinutes}
                              onChange={(e) =>
                                setScanRows((a) =>
                                  a.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          breakMinutes: Number(e.target.value),
                                          confirmed: false,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                        {DateTime.fromISO(row.date).isValid && (
                          <p className="muted">
                            {DateTime.fromISO(row.date)
                              .setLocale(ja ? "ja" : "en")
                              .toFormat("cccc")}{" "}
                            · {t("End date", "終了日")}:{" "}
                            {DateTime.fromISO(row.date)
                              .plus({
                                days:
                                  row.end && row.start && row.end <= row.start
                                    ? 1
                                    : 0,
                              })
                              .toISODate()}
                          </p>
                        )}
                        <label>
                          <input
                            type="checkbox"
                            checked={row.confirmed}
                            onChange={(e) =>
                              setScanRows((a) =>
                                a.map((x, j) =>
                                  j === i
                                    ? { ...x, confirmed: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                          {t(
                            "I verified the name, dates, times and break against the source.",
                            "原本で名前・日付・時刻・休憩を確認しました。",
                          )}
                        </label>
                        {state.shifts.some((s) => s.date === row.date) && (
                          <p className="warning">
                            {t(
                              "Existing shift on this date: duplicate or conflict review needed.",
                              "同日に既存シフトがあります。重複・競合を確認してください。",
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                    {!scanRows.length && (
                      <p className="muted">
                        {t(
                          "Scan results will appear here. Nothing is imported automatically.",
                          "スキャン結果はここに表示されます。自動取込は行いません。",
                        )}
                      </p>
                    )}
                    <label>
                      {t("Conflicting entries", "競合するシフト")}
                      <select
                        value={conflict}
                        onChange={(e) => setConflict(e.target.value)}
                      >
                        <option value="keep">
                          {t(
                            "Keep existing (skip overlaps)",
                            "既存を保持（競合を除外）",
                          )}
                        </option>
                        <option value="replace">
                          {t(
                            "Replace overlapping entries",
                            "競合する既存シフトを置換",
                          )}
                        </option>
                      </select>
                    </label>
                    <button
                      className="primary"
                      disabled={!scanRows.some((r) => r.selected) || scanning}
                      onClick={async () => {
                        try {
                          const rows = scanRows.filter((r) => r.selected);
                          if (rows.some((r) => !r.confirmed))
                            throw Error(
                              "Confirm each selected row after checking the source.",
                            );
                          rows.forEach(validateShift);
                          if (
                            conflict === "replace" &&
                            !confirm(
                              "Replace all overlapping calendar entries?",
                            )
                          )
                            return;
                          const personal = rows.map(
                            ({
                              id,
                              date,
                              start,
                              end,
                              breakMinutes,
                              source,
                              page,
                            }) => ({
                              id,
                              date,
                              start,
                              end,
                              breakMinutes,
                              source,
                              page,
                            }),
                          );
                          const next = await update((s) => {
                            let shifts = s.shifts;
                            if (conflict === "replace")
                              shifts = importShifts(shifts, personal, true);
                            else
                              for (const row of personal) {
                                try {
                                  shifts = importShifts(shifts, [row]);
                                } catch {
                                  /* explicitly chosen skip overlaps */
                                }
                              }
                            return { ...s, shifts };
                          });
                          if (next) {
                            setScanRows([]);
                            setMessage(
                              "Confirmed shifts imported; duplicates and kept conflicts skipped.",
                            );
                          }
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      {t("Import confirmed shifts", "確認したシフトを取り込む")}
                    </button>
                  </section>
                </div>
              )}
            </>
          )}
          {page === "Settings" && (
            <>
              <section className="card">
                <h2>{t("Make it yours", "あなたの設定")}</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      validateRules(settings.rules);
                      if (
                        settings.scannerUrl &&
                        !settings.scannerUrl.startsWith("https://") &&
                        !settings.scannerUrl.startsWith("http://localhost")
                      )
                        throw Error("Use an HTTPS scanner URL");
                      if (
                        await update((s) => ({
                          ...s,
                          settings: structuredClone(settings),
                        }))
                      )
                        setMessage(
                          t(
                            "Settings saved. Historical pay rules remain unchanged.",
                            "設定を保存しました。過去の給与ルールは変更されません。",
                          ),
                        );
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  <div className="form-grid">
                    <label>
                      {t("Your name", "名前")}
                      <input
                        required
                        value={settings.name}
                        onChange={(e) =>
                          setSettings({ ...settings, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Aliases (comma separated)", "別名（カンマ区切り）")}
                      <input
                        value={settings.aliases}
                        onChange={(e) =>
                          setSettings({ ...settings, aliases: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Language", "言語")}
                      <select
                        value={settings.language}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            language: e.target.value as "en" | "ja",
                          })
                        }
                      >
                        <option value="en">English</option>
                        <option value="ja">日本語</option>
                      </select>
                    </label>
                    <label>
                      {t("Appearance", "表示")}
                      <select
                        value={settings.theme}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            theme: e.target.value as typeof settings.theme,
                          })
                        }
                      >
                        <option value="light">{t("Light", "ライト")}</option>
                        <option value="dark">{t("Dark", "ダーク")}</option>
                        <option value="system">
                          {t("Device setting", "端末設定")}
                        </option>
                      </select>
                    </label>
                    {(["rate", "multiplier", "block"] as const).map((k) => (
                      <label key={k}>
                        {k === "rate"
                          ? t("Regular hourly rate (¥)", "通常時給（円）")
                          : k === "multiplier"
                            ? t("Night multiplier", "深夜倍率")
                            : t(
                                "Night block (minutes)",
                                "深夜時間の単位（分）",
                              )}
                        <input
                          required
                          type="number"
                          min={k === "block" ? 1 : 0}
                          max={k === "block" ? 60 : undefined}
                          step={k === "block" ? 1 : 0.01}
                          value={settings.rules[k]}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              rules: {
                                ...settings.rules,
                                [k]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                    {(["nightStart", "nightEnd"] as const).map((k) => (
                      <label key={k}>
                        {k === "nightStart"
                          ? t("Night starts", "深夜開始")
                          : t(
                              "Night ends (05:00 assumption)",
                              "深夜終了（初期仮定05:00）",
                            )}
                        <input
                          required
                          type="time"
                          value={settings.rules[k]}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              rules: { ...settings.rules, [k]: e.target.value },
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      {t("Final currency rounding", "最終金額の丸め")}
                      <select
                        value={settings.rules.rounding}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            rules: {
                              ...settings.rules,
                              rounding: e.target
                                .value as typeof settings.rules.rounding,
                            },
                          })
                        }
                      >
                        <option value="nearest">
                          {t("Nearest whole yen", "円単位の四捨五入")}
                        </option>
                        <option value="floor">
                          {t("Round down", "切り捨て")}
                        </option>
                        <option value="none">
                          {t("Keep precision", "精度を保持")}
                        </option>
                      </select>
                    </label>
                    <label>
                      {t("Secure scanner endpoint", "安全なスキャナーURL")}
                      <input
                        type="url"
                        value={settings.scannerUrl}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            scannerUrl: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="muted">
                    {t("Night rate", "深夜時給")}:{" "}
                    {yen(settings.rules.rate * settings.rules.multiplier)}.{" "}
                    {t(
                      "Unpaid breaks excluded. Night minutes summed, then rounded down once per session. Regular time is never rounded down. Planned break estimates assume the break begins at shift start because its timing is unknown.",
                      "無給休憩を除外。深夜時間は合算後、勤務ごとに一度切り捨てます。通常時間は切り捨てません。予定の休憩は時刻不明のため開始時に置く推定です。",
                    )}
                  </p>
                  <button className="primary" type="submit">
                    {t("Save settings", "設定を保存")}
                  </button>
                </form>
              </section>
              <section className="card">
                <h2>{t("Your data stays yours", "データ管理")}</h2>
                <p className="muted">
                  {t(
                    "Back up regularly. Browser storage can be cleared by your device. Backups contain your personal records.",
                    "定期的にバックアップしてください。端末がブラウザーのデータを削除する場合があります。",
                  )}
                </p>
                <button
                  onClick={() =>
                    download(
                      `shiftly-backup-${currentMonth}.json`,
                      JSON.stringify(state, null, 2),
                    )
                  }
                >
                  <Download size={17} />
                  {t("Export JSON backup", "JSONバックアップ")}
                </button>
                <label>
                  {t("Restore mode", "復元方法")}
                  <select
                    value={restoreMode}
                    onChange={(e) => setRestoreMode(e.target.value)}
                  >
                    <option value="merge">
                      {t("Merge without duplicates", "重複せずに結合")}
                    </option>
                    <option value="replace">
                      {t("Replace all data", "すべてのデータを置換")}
                    </option>
                  </select>
                </label>
                <input
                  aria-label="Restore backup"
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      if (f.size > 10 * 1024 * 1024)
                        throw Error("Backup exceeds 10 MB");
                      const backup = parseBackup(JSON.parse(await f.text()));
                      if (
                        restoreMode === "replace" &&
                        !confirm("Replace all local data with this backup?")
                      )
                        return;
                      const result = await update((s) => {
                        if (restoreMode === "replace") return backup;
                        const sessions = [...s.sessions];
                        for (const x of backup.sessions) {
                          if (
                            !sessions.some(
                              (y) =>
                                y.id === x.id ||
                                (y.start === x.start &&
                                  y.end === x.end &&
                                  y.zone === x.zone),
                            )
                          )
                            sessions.push(x);
                        }
                        return parseBackup({
                          ...s,
                          shifts: importShifts(s.shifts, backup.shifts),
                          sessions,
                        });
                      });
                      if (result) {
                        setSettings(result.settings);
                        setMessage("Backup restored.");
                      }
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                    e.target.value = "";
                  }}
                />
                <div className="danger-zone">
                  <button
                    className="danger"
                    onClick={async () => {
                      if (
                        confirm(
                          "Permanently erase all local shifts, sessions and settings? Export a backup first.",
                        ) &&
                        confirm("This cannot be undone. Clear all data?")
                      ) {
                        await update(() => structuredClone(initial));
                        setSettings(initial.settings);
                        setUndo([]);
                        setFiles([]);
                        setScanRows([]);
                        setMessage("Local data cleared.");
                      }
                    }}
                  >
                    <Trash2 size={16} />
                    {t("Clear local data", "ローカルデータを削除")}
                  </button>
                </div>
              </section>
            </>
          )}
          <footer>
            {t("A calmer way to keep track.", "勤務管理をもっとシンプルに。")}{" "}
            <span>
              shiftly ·{" "}
              {t("All salary amounts are estimates", "給与額はすべて推定です")}
            </span>
          </footer>
        </main>
      </div>
      {editShift && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit shift"
          >
            <div className="section-title">
              <h2>{t("Shift details", "シフト詳細")}</h2>
              <button onClick={() => setEditShift(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  validateShift(editShift);
                  const next = await update((s) => ({
                    ...s,
                    shifts: importShifts(
                      s.shifts.filter((x) => x.id !== editShift.id),
                      [editShift],
                    ),
                  }));
                  if (next) setEditShift(null);
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <div className="form-grid">
                {(["date", "start", "end"] as const).map((k) => (
                  <label key={k}>
                    {k === "date"
                      ? t("Date", "日付")
                      : k === "start"
                        ? t("Start", "開始")
                        : t("End", "終了")}
                    <input
                      required
                      type={k === "date" ? "date" : "time"}
                      value={editShift[k]}
                      onChange={(e) =>
                        setEditShift({ ...editShift, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  {t("Unpaid break minutes", "無給休憩（分）")}
                  <input
                    type="number"
                    min="0"
                    value={editShift.breakMinutes}
                    onChange={(e) =>
                      setEditShift({
                        ...editShift,
                        breakMinutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              {editShift.end <= editShift.start && (
                <p>
                  {t("End date is the next day.", "終了日は翌日です。")}{" "}
                  {DateTime.fromISO(editShift.date)
                    .plus({ days: 1 })
                    .toISODate()}
                </p>
              )}
              <div className="button-group">
                <button className="primary" type="submit">
                  {t("Save shift", "保存")}
                </button>
                {state.shifts.some((s) => s.id === editShift.id) && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => remove([editShift.id])}
                  >
                    {t("Delete", "削除")}
                  </button>
                )}
              </div>
            </form>
            {message && <p role="alert">{message}</p>}
          </section>
        </div>
      )}
      {editSession && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Session summary"
          >
            <div className="section-title">
              <h2>{t("Work session summary", "勤務サマリー")}</h2>
              <button onClick={() => setEditSession(null)} aria-label="Close">
                ×
              </button>
            </div>
            <p className="muted">
              {editSession.zone} ·{" "}
              {t("Original pay rules retained", "元の給与ルールを保持")} ·{" "}
              {yen(editSession.rules.rate)}/h × {editSession.rules.multiplier}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const corrected = { ...editSession, lastAction: Date.now() };
                  validateSession(corrected);
                  const next = await update((s) => {
                    const original = s.sessions.find(
                      (x) => x.id === corrected.id,
                    );
                    if (
                      !original ||
                      original.lastAction !== editSession.lastAction
                    )
                      throw Error(
                        "Session changed in another tab. Close and reopen this editor.",
                      );
                    if (
                      !corrected.end &&
                      s.sessions.some((x) => x.id !== corrected.id && !x.end)
                    )
                      throw Error("Another session is active");
                    return {
                      ...s,
                      sessions: s.sessions.map((x) =>
                        x.id === corrected.id ? corrected : x,
                      ),
                    };
                  });
                  if (next) {
                    setEditSession(null);
                    clockBaseline.current = {
                      wall: Date.now(),
                      mono: performance.now(),
                    };
                    setClockWarning(false);
                  }
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <div className="form-grid">
                <label>
                  {t("Start", "開始")}
                  <input
                    required
                    type="datetime-local"
                    step="1"
                    value={local(editSession.start, editSession.zone)}
                    onChange={(e) =>
                      setEditSession({
                        ...editSession,
                        start: DateTime.fromISO(e.target.value, {
                          zone: editSession.zone,
                        }).toMillis(),
                      })
                    }
                  />
                </label>
                <label>
                  {t("End (blank while active)", "終了（勤務中は空欄）")}
                  <input
                    type="datetime-local"
                    step="1"
                    value={
                      editSession.end
                        ? local(editSession.end, editSession.zone)
                        : ""
                    }
                    onChange={(e) =>
                      setEditSession({
                        ...editSession,
                        end: e.target.value
                          ? DateTime.fromISO(e.target.value, {
                              zone: editSession.zone,
                            }).toMillis()
                          : undefined,
                      })
                    }
                  />
                </label>
                <label>
                  {t("Link calendar shift", "予定シフトに連携")}
                  <select
                    value={editSession.shiftId ?? ""}
                    onChange={(e) =>
                      setEditSession({
                        ...editSession,
                        shiftId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">{t("Unlinked", "連携なし")}</option>
                    {state.shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} {s.start}–{s.end}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <h3>{t("Unpaid breaks", "無給休憩")}</h3>
              {editSession.breaks.map((b, i) => (
                <div className="break-row" key={i}>
                  <input
                    aria-label="Break start"
                    type="datetime-local"
                    step="1"
                    value={local(b.start, editSession.zone)}
                    onChange={(e) =>
                      setEditSession({
                        ...editSession,
                        breaks: editSession.breaks.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                start: DateTime.fromISO(e.target.value, {
                                  zone: editSession.zone,
                                }).toMillis(),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="Break end"
                    type="datetime-local"
                    step="1"
                    value={b.end ? local(b.end, editSession.zone) : ""}
                    onChange={(e) =>
                      setEditSession({
                        ...editSession,
                        breaks: editSession.breaks.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                end: e.target.value
                                  ? DateTime.fromISO(e.target.value, {
                                      zone: editSession.zone,
                                    }).toMillis()
                                  : undefined,
                              }
                            : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label="Delete break"
                    onClick={() =>
                      setEditSession({
                        ...editSession,
                        breaks: editSession.breaks.filter((_, j) => j !== i),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setEditSession({
                    ...editSession,
                    breaks: [
                      ...editSession.breaks,
                      { start: editSession.start, end: editSession.start },
                    ],
                  })
                }
              >
                {t("Add break", "休憩を追加")}
              </button>
              <div className="summary-preview">
                {(() => {
                  try {
                    const c = calculate(editSession);
                    return (
                      <>
                        <strong>{yen(c.total)}</strong>
                        <p>
                          {t("Regular", "通常")}: {duration(c.regularMs)} ·{" "}
                          {yen(c.regularPay)}
                          <br />
                          {t("Night earnings", "深夜給与")}: {yen(c.nightPay)}
                          <br />
                          {t("Unpaid break", "無給休憩")}: {duration(c.breakMs)}
                        </p>
                        <p>
                          {duration(c.workMs)} {t("worked", "勤務")} ·{" "}
                          {duration(c.nightMs)}{" "}
                          {t("actual night", "実際の深夜")} ·{" "}
                          {duration(c.payableNightMs)}{" "}
                          {t("payable night", "支払対象の深夜")}
                        </p>
                      </>
                    );
                  } catch (e) {
                    return <p role="alert">{(e as Error).message}</p>;
                  }
                })()}
              </div>
              <button className="primary" type="submit">
                {t("Save & recalculate", "保存して再計算")}
              </button>
            </form>
            {message && <p role="alert">{message}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

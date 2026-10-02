import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:4173");
await page
  .getByRole("heading", { name: "A little clarity for your workday." })
  .waitFor();
await page.screenshot({
  path: "artifacts/dashboard-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Start Shift", exact: true }).click();
await page.getByRole("button", { name: "Start Break", exact: true }).waitFor();
await page.reload();
await page.getByRole("button", { name: "Start Break", exact: true }).click();
await page.getByRole("button", { name: "Resume Shift", exact: true }).click();
await page.getByRole("button", { name: "End Shift", exact: true }).click();
await page
  .getByRole("button", { name: "Save & recalculate", exact: true })
  .click();
await page.getByRole("button", { name: "Add shift", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Save shift", exact: true })
  .click();
await page.getByRole("button", { name: "Calendar", exact: true }).click();
await page.getByRole("button", { name: "Agenda view", exact: true }).click();
await page.getByRole("checkbox").check();
page.once("dialog", (d) => d.accept());
await page
  .getByRole("button", { name: "Delete selected", exact: true })
  .click();
await page.getByRole("button", { name: "Undo", exact: true }).click();
await page
  .getByRole("button", { name: "Monthly Reports", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Daily breakdown", exact: true })
  .waitFor();
await page.screenshot({ path: "artifacts/report-desktop.png", fullPage: true });
await page.getByRole("button", { name: "Dashboard", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "artifacts/dashboard-mobile.png",
  fullPage: true,
});
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw Error("Mobile horizontal overflow");
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.getByLabel(/Appearance/).selectOption("dark");
await page.getByRole("button", { name: "Save settings", exact: true }).click();
await page.getByRole("button", { name: "Dashboard", exact: true }).click();
await page.screenshot({
  path: "artifacts/dashboard-dark-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "日本語", exact: true }).click();
await page
  .getByRole("heading", { name: "今日の勤務を、すっきり。", exact: true })
  .waitFor();
await context.setOffline(true);
await page.reload();
await page
  .getByRole("heading", { name: "今日の勤務を、すっきり。", exact: true })
  .waitFor();
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "PASS: desktop/mobile, timer refresh, breaks, completion, manual shift, deletion/undo, reports, dark mode, Japanese, offline reload; no runtime errors.",
);
await browser.close();

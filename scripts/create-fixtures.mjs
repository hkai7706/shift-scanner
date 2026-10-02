import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  await page.goto(
    pathToFileURL(resolve("fixtures/sample-shift-sheet.html")).href,
  );
  await page.screenshot({
    path: "fixtures/sample-shift-sheet.png",
    fullPage: true,
  });
  await page.addStyleTag({
    content: "@media print{body{font-size:16px} .page-two{break-before:page}}",
  });
  await page.evaluate(() => {
    const section = document.createElement("section");
    section.className = "page-two";
    section.innerHTML =
      "<h1>サンプル・テスト専用 / 2026年10月 第2ページ</h1><p>凡例 B = 12:00–18:00（休憩なし） / ? = 時間未定 / 休 = 公休</p><table><tr><th>名前</th><th>10月5日(月)</th><th>10月6日(火)</th></tr><tr><td>田中</td><td>09:00–17:00</td><td>09:00–17:00</td></tr><tr><td>ゼーリン</td><td>B</td><td>?</td></tr></table><p>Expected: October 5 12:00–18:00; October 6 unresolved time must remain blank. Never import without review.</p>";
    document.body.append(section);
  });
  await page.pdf({
    path: "fixtures/sample-multipage-shift-sheet.pdf",
    format: "A4",
    printBackground: true,
  });
  console.log("Created clearly labeled PNG and two-page PDF scanner fixtures.");
} finally {
  await browser.close();
}

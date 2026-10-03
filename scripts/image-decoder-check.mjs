// Local-only rendering test. No image is sent to the scanner or any external service.
import { chromium } from "@playwright/test";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile("src/images.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const bytes = Array.from(await readFile("fixtures/sample-shift-sheet.png"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  const result = await page.evaluate(
    async ({ code, bytes }) => {
      const url = URL.createObjectURL(
        new Blob([code], { type: "text/javascript" }),
      );
      const { imageToScanData } = await import(url);
      URL.revokeObjectURL(url);
      const file = new File([new Uint8Array(bytes)], "sample.png", {
        type: "image/png",
      });
      const normal = await imageToScanData(file);
      window.createImageBitmap = async () => {
        throw new TypeError("Load failed");
      };
      const fallback = await imageToScanData(file);
      return {
        normal: normal.startsWith("data:image/jpeg;base64,"),
        fallback: fallback.startsWith("data:image/jpeg;base64,"),
      };
    },
    { code, bytes },
  );
  if (!result.normal || !result.fallback) throw Error("Image decode failed");
  console.log(
    "PASS: normal decode and Safari bitmap-failure fallback render locally; no external network requests.",
  );
} finally {
  await browser.close();
}

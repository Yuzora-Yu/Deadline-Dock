// Isolated headless Edge profile: never attaches to the user's browser or data.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "vite.web.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    "1422",
    "--strictPort",
  ],
  { windowsHide: true, stdio: "pipe" },
);
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));
let browser, page;
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const r = await fetch("http://127.0.0.1:1422/tools/deadline-dock/");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) =>
    console.error("REQUEST FAILED", r.url(), r.failure()?.errorText),
  );
  page.on("console", (m) => {
    if (m.type() === "error") console.error("BROWSER", m.text());
  });
  await page.goto("http://127.0.0.1:1422/tools/deadline-dock/");
  // Creating a draft must not persist anything until registration succeeds.
  await page.getByRole('button', {name:'＋ タスクを詳しく登録', exact:true}).click();
  await page.getByRole('textbox', {name:'件名', exact:true}).fill('登録しない下書き');
  await page.getByRole('button', {name:'閉じる', exact:true}).click();
  await expect(page.getByText('入力した内容を破棄して閉じますか？')).toBeVisible();
  await page.getByRole('button', {name:'破棄して閉じる', exact:true}).click();
  await expect(page.locator('.tasks article')).toHaveCount(0);
  await page.getByRole('button', {name:'＋ タスクを詳しく登録', exact:true}).click();
  await page.getByRole('textbox', {name:'件名', exact:true}).fill('明日の準備をする');
  await page.getByRole('textbox', {name:'作業内容', exact:true}).fill('必要な資料と持ち物を確認');
  await page.getByRole('textbox', {name:'チェック項目を追加', exact:true}).fill('資料をそろえる');
  // An item still in the add field is included, not silently discarded.
  await fs.mkdir('windows-build', {recursive:true});
  await page.screenshot({path:'windows-build/web-composer.png',fullPage:true});
  await page.getByRole('button', {name:'登録する', exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".task-body")).toContainText(
    "必要な資料と持ち物を確認",
  );
  await expect(page.locator(".task-body")).toContainText("0/1");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.id).toBe('/tools/deadline-dock/');
  for (const size of [192,512]) {
    expect(manifest.icons.some(i => i.sizes === `${size}x${size}` && i.type === 'image/png')).toBe(true);
    const measured = await page.evaluate(async size => {const image=new Image(); image.src=`./icon-${size}.png`; await image.decode(); return [image.naturalWidth,image.naturalHeight];},size);
    expect(measured).toEqual([size,size]);
  }
  // Prompt arrives before Settings opens: the handler must remain mounted.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', {cancelable:true});
    e.prompt = async () => { window.__installPrompted = true; };
    e.userChoice = Promise.resolve({outcome:'accepted'});
    window.dispatchEvent(e);
  });
  await page.getByRole('button',{name:'⚙ 設定',exact:true}).click();
  await page.getByRole('button',{name:'アプリをインストール',exact:true}).click();
  expect(await page.evaluate(() => window.__installPrompted)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('heading',{name:'アプリとして利用中'})).toBeVisible();
  await page.getByRole('button',{name:'▤ タスク',exact:true}).click();
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("textbox", { name: "タスクを追加", exact: true })
    .fill("通信がない場所で登録");
  await page.getByRole("button", { name: "タスクを登録", exact: true }).click();
  await expect(page.locator(".tasks article")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".tasks article")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "通信がない場所で登録を完了にする",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "✓ 完了済み", exact: true }).click();
  await expect(page.locator(".task-body")).toContainText(
    "通信がない場所で登録",
  );
  await page.locator(".task-body").click();
  await page.getByRole("button", { name: "タスクを削除", exact: true }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.locator(".tasks article")).toHaveCount(0);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.locator(".tasks article")).toHaveCount(1);
  await context.setOffline(false);
  await page.getByRole("button", { name: "▤ タスク", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await fs.mkdir("windows-build", { recursive: true });
  await page.screenshot({
    path: path.resolve("windows-build/web-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS: 390px mobile UI, first-registration details/checklist, unsaved draft protection, PWA icons/install event, IndexedDB reload, offline reload/create, completion, deletion/undo, no horizontal overflow, no JS errors.",
  );
} catch (e) {
  if (page) {
    console.error(await page.locator("body").innerText());
    await fs.mkdir("windows-build", { recursive: true });
    await page.screenshot({
      path: path.resolve("windows-build/web-failure.png"),
    });
  }
  throw e;
} finally {
  await browser?.close();
  server.kill();
}

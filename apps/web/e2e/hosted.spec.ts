import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
let process: ChildProcess, origin: string;
test.beforeAll(async () => {
  process = spawn(
    "bun",
    [new URL("./fixtures/hosted.ts", import.meta.url).pathname],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  process.stderr!.on("data", (chunk) => {
    stderr += chunk;
  });
  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error(stderr || "Hosted fixture did not start.")),
      15_000,
    );
    process.stdout!.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(String(chunk).trim());
    });
    process.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Fixture exited ${code}: ${stderr}`));
    });
  });
});
test.afterAll(async () => {
  if (process && process.exitCode === null && !process.killed) {
    process.kill("SIGTERM");
    await new Promise<void>((resolve) => process.once("exit", () => resolve()));
  }
});
test("signs in from the browser, saves workspace settings and releases a persistent guest link", async ({
  page,
  browser,
}) => {
  await page.route("**/auth/login", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const state = new URL(response.headers().location!).searchParams.get(
      "state",
    );
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        location: `${origin}/github/callback?code=test&state=${state}`,
      },
    });
  });
  await page.goto(`${origin}/app/?lang=en`);
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL(`${origin}/app/`);
  await expect(
    page.getByRole("button", { name: "Share workspace", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings (⌘,)" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings
    .getByRole("button", { name: "Workspace", exact: true })
    .click();
  await settings
    .getByLabel("Workspace name", { exact: true })
    .fill("Cloud team");
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(
    settings.getByText("Workspace updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Share workspace", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings (⌘,)" }).click();
  await settings
    .getByRole("button", { name: "Workspace", exact: true })
    .click();
  await expect(
    settings.getByLabel("Workspace name", { exact: true }),
  ).toHaveValue("Cloud team");
  await settings.getByRole("button", { name: "Close settings" }).click();
  await page
    .getByRole("button", { name: /Share workspace|Share/, exact: false })
    .first()
    .click();
  const share = page.getByRole("dialog", { name: "Share workspace" });
  await expect(share).toBeVisible();
  await share
    .getByRole("button", { name: "Enable collaboration link" })
    .click();
  const url = await share
    .getByRole("textbox", { name: "Join link" })
    .inputValue();
  expect(url).toMatch(/\/join\//);
  await expect(share).not.toContainText("cloudflared");
  const guest = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    }),
    guestPage = await guest.newPage();
  await guestPage.goto(url);
  await expect(
    guestPage.getByText("Cloud team", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    guestPage.getByRole("button", { name: "Continue with GitHub" }),
  ).toHaveCount(0);
  await guest.close();
});

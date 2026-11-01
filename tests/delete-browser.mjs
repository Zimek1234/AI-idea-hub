import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const origin = process.env.TEST_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin);
  await page.locator(".entry-card").first().waitFor();
  await page.getByLabel("Open team chat", { exact: true }).click();
  const chat = page.locator("#team-chat");
  await chat.getByRole("button", { name: /Claude/ }).click();
  let detail = page.getByRole("dialog", { name: "Claude", exact: true });
  await detail.waitFor();
  assert.equal(
    await detail
      .getByRole("button", { name: "Delete permanently", exact: true })
      .count(),
    0,
  );
  await detail.getByLabel("Entry status").selectOption("Trash");
  await detail
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  let confirm = page.getByRole("dialog", {
    name: "Delete permanently?",
    exact: true,
  });
  await confirm.waitFor();
  assert.match(await confirm.innerText(), /cannot be undone/);
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  detail = page.getByRole("dialog", { name: "Claude", exact: true });
  await detail.waitFor();
  assert.equal(await detail.getByLabel("Entry status").inputValue(), "Trash");
  await detail.getByLabel("Entry status").selectOption("Using");
  assert.equal(
    await detail
      .getByRole("button", { name: "Delete permanently", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator(".entry-card").count(), 8);
  console.log(
    "PASS Delete permanently is limited to Trash; cancel preserves the entry and restoring it still works",
  );
  await detail.getByLabel("Entry status").selectOption("Trash");
  await detail
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await detail.waitFor();
  await detail
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  confirm = page.getByRole("dialog", {
    name: "Delete permanently?",
    exact: true,
  });
  await confirm
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".entry-card").length === 7,
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  await chat
    .getByText("Shared entry permanently deleted", { exact: true })
    .waitFor();
  assert.equal(await chat.locator(".chat-message").count(), 3);
  assert.equal(await chat.locator(".chat-tool-card").count(), 0);
  console.log(
    "PASS Escape cancels confirmation; confirmed deletion removes the entry while chat history displays a tombstone",
  );
  await page.reload();
  await page.locator(".entry-card").first().waitFor();
  assert.equal(await page.locator(".entry-card").count(), 8);
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS demo deletion is memory-only and resets on reload without browser errors",
  );
} finally {
  await browser.close();
}

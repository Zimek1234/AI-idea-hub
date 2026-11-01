import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (new URL(r.url()).origin !== new URL(origin).origin)
    external.push(r.url());
});
try {
  await mkdir("/tmp/ai-hub-artifacts", { recursive: true });
  await page.goto(origin);
  await page.getByLabel("Open team chat", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("3 unread messages").count(), 1);
  await page.getByLabel("Open team chat", { exact: true }).click();
  const panel = page.locator("#team-chat");
  await panel.getByText("Jamie Lee", { exact: true }).first().waitFor();
  assert.equal(await panel.locator(".chat-message").count(), 3);
  await page.waitForFunction(() => !document.querySelector(".chat-unread"));
  assert.ok(
    await page
      .locator(".main-shell")
      .evaluate(
        (el) => el.getBoundingClientRect().right <= window.innerWidth - 379,
      ),
  );
  await panel
    .getByLabel("Message your team", { exact: true })
    .fill("A private demo thought <script>alert(1)</script>");
  await panel.getByRole("button", { name: "Send", exact: false }).click();
  await panel
    .getByText("A private demo thought <script>alert(1)</script>", {
      exact: true,
    })
    .waitFor();
  assert.equal(await panel.locator("script").count(), 0);
  const latest = panel.locator(".chat-message").last();
  await latest.getByRole("button", { name: "Reply", exact: true }).click();
  await panel
    .getByLabel("Message your team", { exact: true })
    .fill("Let's test this together.");
  await panel.getByRole("button", { name: "Send", exact: false }).click();
  const reply = panel.locator(".chat-message").last();
  assert.match(
    await reply.locator("blockquote").innerText(),
    /private demo thought/,
  );
  await reply
    .getByLabel("Add reaction to message from You", { exact: true })
    .click();
  const reaction = reply.getByLabel("React 👍 to message from You", {
    exact: true,
  });
  await reaction.click();
  const badge = reply.getByRole("button", { name: /Toggle 👍 reaction/ });
  assert.equal(await badge.getAttribute("aria-pressed"), "true");
  await badge.click();
  assert.equal(await badge.count(), 0);
  await panel
    .getByRole("button", { name: "Share from Idea Hub", exact: true })
    .click();
  await panel.getByLabel("Search Idea Hub entries").fill("Claude");
  await panel
    .getByRole("button", { name: "Claude · AI Library", exact: true })
    .click();
  await panel.getByRole("button", { name: "Send", exact: false }).click();
  await panel
    .locator(".chat-message")
    .last()
    .getByRole("button", { name: /Claude/ })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Close dialog", { exact: true }).click();
  assert.equal(await panel.isVisible(), true);
  await page.getByLabel("Close team chat", { exact: true }).click();
  await page.getByLabel("Open team chat", { exact: true }).click();
  assert.equal(await panel.locator(".chat-message").count(), 6);
  await page.screenshot({
    path: "/tmp/ai-hub-artifacts/chat-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS desktop panel, unread indicator, send, plain-text safety, replies, toggle reactions and tool cards",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog", { name: "Team chat", exact: false }).waitFor();
  const bounds = await panel.boundingBox();
  assert.equal(bounds.width, 390);
  assert.equal(bounds.height, 844);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await panel.getByLabel("Message your team").focus();
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), false);
  assert.equal(
    await page
      .getByLabel("Open team chat", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByLabel("Open team chat", { exact: true }).click();
  await panel.getByLabel("Close team chat", { exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await panel
      .getByRole("button", { name: "Send", exact: false })
      .evaluate((el) => el === document.activeElement),
    false,
  ); // disabled sends are skipped
  assert.equal(
    await panel.evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  await page.screenshot({
    path: "/tmp/ai-hub-artifacts/chat-mobile.png",
    fullPage: true,
  });
  console.log(
    "PASS mobile full-screen layout, Escape, focus restoration and focus containment",
  );
  const other = await browser.newPage();
  await other.goto(origin);
  await other.getByLabel("Open team chat", { exact: true }).click();
  assert.equal(await other.locator(".chat-message").count(), 3);
  assert.equal(
    await other.getByText("Let's test this together.", { exact: true }).count(),
    0,
  );
  await page.reload();
  await page.getByLabel("Open team chat", { exact: true }).click();
  assert.equal(await panel.locator(".chat-message").count(), 3);
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS demo messages reset on reload, stay isolated between visitors, use no Web Storage or external requests",
  );
} finally {
  await browser.close();
}

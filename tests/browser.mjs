import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
let checks = 0;
const pass = (message) => {
  checks++;
  console.log(`PASS ${message}`);
};
try {
  await page.goto(process.env.TEST_URL || "http://localhost:3000");
  await page
    .getByRole("heading", { name: "A little curiosity. Endless possibility." })
    .waitFor();
  await page.locator(".entry-card").first().waitFor();
  assert.equal(await page.locator(".entry-card").count(), 8);
  pass("desktop library renders all 8 demo entries");
  await mkdir("/tmp/ai-hub-artifacts", { recursive: true });

  await page.getByLabel("Search your library").fill("coding");
  assert.equal(await page.locator(".entry-card").count(), 2);
  await page.getByLabel("Clear search").click();
  await page.getByLabel("Filter by category").selectOption("Prompt");
  assert.equal(await page.locator(".entry-card").count(), 1);
  await page.getByLabel("Filter by category").selectOption("All");
  await page.getByLabel("Filter by status").selectOption("Using");
  assert.equal(await page.locator(".entry-card").count(), 3);
  await page.getByLabel("Filter by status").selectOption("All");
  pass("search, category and status filters work");
  await page.screenshot({
    path: "/tmp/ai-hub-artifacts/desktop.png",
    fullPage: true,
  });
  await page.getByLabel("List view", { exact: true }).click();
  assert.ok(
    await page
      .locator(".entry-grid")
      .evaluate((e) => e.classList.contains("list-view")),
  );
  await page.getByLabel("Grid view", { exact: true }).click();
  pass("grid and list views switch");
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByLabel(/^Title/).fill("Browser test discovery");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A useful experiment to share with the team.");
  await page
    .getByLabel("Source URL")
    .fill("https://example.com/test?utm_source=browser");
  await page.getByLabel(/^Tags/).fill("testing, research");
  await page
    .getByRole("button", { name: "Save discovery", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Browser test discovery", exact: true })
    .waitFor();
  assert.equal(await page.locator(".entry-card").count(), 9);
  pass("add-entry form saves and displays a discovery");
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByLabel(/^Title/).fill("Browser test discovery");
  await page
    .getByRole("button", { name: "Save discovery", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "Already saved" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator(".entry-card").count(), 9);
  pass("duplicate discoveries are rejected");
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", {
        name: "Browser test discovery",
        exact: true,
      }),
    })
    .click();
  await page.getByLabel("Entry status").selectOption("Testing");
  await page.getByRole("button", { name: "My notes", exact: true }).click();
  await page.getByLabel("Rate 4 out of 5").click();
  await page.getByLabel("Personal notes").fill("Private browser note");
  await page
    .getByRole("button", { name: "Save my notes", exact: true })
    .click();
  await page.getByRole("button", { name: "Saved ✓", exact: true }).waitFor();
  pass("detail status and private feedback controls work");
  await page.getByRole("button", { name: "Comments (0)", exact: true }).click();
  await page.getByLabel("Add a comment").fill("A shared thought");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.getByText("A shared thought", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(
    await page.getByText("A shared thought", { exact: true }).count(),
    0,
  );
  pass("comments can be created and deleted");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Edit entry", exact: true }).click();
  await page.getByLabel(/^Title/).fill("Edited discovery");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Edited discovery", exact: true })
    .waitFor();
  pass("editing updates an existing entry");
  await page
    .getByRole("button", { name: "Ideas & Projects", exact: true })
    .click();
  await page.getByRole("button", { name: "New idea", exact: true }).click();
  await page.getByLabel(/^Title/).fill("Build a research agent");
  await page
    .getByRole("button", { name: "Save discovery", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Build a research agent", exact: true })
    .waitFor();
  assert.equal(await page.locator(".entry-card").count(), 1);
  pass("Ideas & Projects is a separate working collection");
  await page
    .getByRole("button", { name: "AI Library", exact: false })
    .first()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.getByLabel("Open navigation").click();
  await page
    .getByRole("button", { name: "Ideas & Projects", exact: true })
    .click();
  assert.equal(await page.locator(".sidebar.is-open").count(), 0);
  await page.waitForFunction(
    () => document.querySelector(".sidebar").getBoundingClientRect().right <= 0,
  );
  await page.screenshot({
    path: "/tmp/ai-hub-artifacts/mobile.png",
    fullPage: true,
  });
  pass("mobile layout has no horizontal overflow and navigation works");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  pass("dialog opens and closes with Escape");
  const mcp = await page.request.post(new URL("/mcp", page.url()).href, {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  assert.equal(mcp.status(), 503);
  const get = await page.request.get(new URL("/mcp", page.url()).href);
  assert.equal(get.status(), 405);
  pass("unconfigured MCP fails closed and disallows GET");
  assert.deepEqual(errors, []);
  pass("no uncaught browser errors");
  console.log(
    `${checks} browser checks passed. Screenshots: /tmp/ai-hub-artifacts`,
  );
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const origin = process.env.TEST_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const external = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(origin).origin)
      external.push(r.url());
  });
  await page.goto(origin);
  await page
    .getByText("Interactive demo · Changes stay in this session.")
    .waitFor();
  assert.equal(await page.locator(".entry-card").count(), 8);
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByLabel(/^Title/).fill("Deployment security check");
  await page
    .getByRole("button", { name: "Save discovery", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Deployment security check", exact: true })
    .waitFor();
  assert.equal(await page.locator(".entry-card").count(), 9);
  const second = await browser.newPage();
  await second.goto(origin);
  await second.locator(".entry-card").first().waitFor();
  assert.equal(await second.locator(".entry-card").count(), 8);
  assert.equal(
    await second
      .getByRole("heading", { name: "Deployment security check", exact: true })
      .count(),
    0,
  );
  await page.reload();
  await page.locator(".entry-card").first().waitFor();
  assert.equal(await page.locator(".entry-card").count(), 8);
  assert.equal(
    await page
      .getByRole("heading", { name: "Deployment security check", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assert.deepEqual(external, []);
  for (const authorization of [null, "Bearer invalid-token"]) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (authorization) headers.Authorization = authorization;
    const response = await page.request.post(new URL("/mcp", origin).href, {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "add_ai_tool",
          arguments: {
            workspace_id: "20000000-0000-4000-8000-000000000001",
            title: "Anonymous write",
            category: "Tool",
          },
        },
      },
    });
    assert.equal(response.status(), 503);
    assert.equal((await response.json()).error, "MCP is not configured.");
  }
  console.log(
    "PASS demo uses synthetic samples; edits are memory-only, reset on reload and are not shared between visitors.",
  );
  console.log(
    "PASS no external browser requests, cookies for application data, or Web Storage writes are needed for demo edits.",
  );
  console.log(
    "PASS anonymous and invalid-bearer MCP write attempts return 503 with Supabase unconfigured.",
  );
} finally {
  await browser.close();
}

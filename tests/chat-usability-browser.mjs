import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const count = () => page.locator(".chat-message").count();
try {
  await page.goto(process.env.TEST_URL || "http://localhost:3000");
  await page.getByLabel("Open team chat", { exact: true }).click();
  const chat = page.locator("#team-chat"),
    composer = chat.getByLabel("Message your team", { exact: true });
  assert.equal(await count(), 3);
  assert.equal(await chat.getByRole("button", { name: /^React / }).count(), 0);
  assert.equal(
    await chat.getByRole("button", { name: /^Add reaction/ }).count(),
    3,
  );
  await composer.fill("Hello");
  await composer.press("Shift+Enter");
  await composer.press("End");
  await composer.type("team");
  assert.equal(await composer.inputValue(), "Hello\nteam");
  await composer.press("Enter");
  await chat.getByText("Hello\nteam", { exact: true }).waitFor();
  assert.equal(await count(), 4);
  assert.equal(await composer.inputValue(), "");
  await composer.fill(" \n\t ");
  await composer.press("Enter");
  assert.equal(await count(), 4);
  assert.equal(
    await chat.getByRole("button", { name: /^Send/ }).isDisabled(),
    true,
  );
  await composer.fill("こんにちは");
  await composer.dispatchEvent("compositionstart");
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: false,
  });
  assert.equal(await count(), 4);
  await composer.dispatchEvent("compositionend");
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
  });
  assert.equal(await count(), 4);
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    repeat: true,
  });
  assert.equal(await count(), 4);
  await composer.press("Enter");
  await chat.getByText("こんにちは", { exact: true }).waitFor();
  assert.equal(await count(), 5);
  console.log(
    "PASS Enter sends, Shift+Enter adds a line, whitespace/repeated Enter are ignored, and IME composition is preserved",
  );

  await page
    .getByRole("button", { name: "Ideas & Projects", exact: true })
    .click();
  await page.getByRole("button", { name: "New idea", exact: true }).click();
  await page.getByLabel(/^Title/).fill("Research sprint plan");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A project for testing research workflows");
  await page
    .getByRole("button", { name: "Save discovery", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Research sprint plan", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "AI Library", exact: false })
    .first()
    .click();
  await composer.fill("Let's work on this");
  await chat
    .getByRole("button", { name: "Share from Idea Hub", exact: true })
    .click();
  const picker = chat.getByRole("dialog", {
    name: "Share from Idea Hub",
    exact: true,
  });
  await picker
    .getByRole("heading", { name: "AI Library", exact: true })
    .waitFor();
  await picker
    .getByRole("heading", { name: "Ideas & Projects", exact: true })
    .waitFor();
  const search = picker.getByLabel("Search Idea Hub entries");
  await search.fill("sprint");
  await search.press("Enter");
  assert.equal(await count(), 5);
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.count(), 0);
  assert.equal(await composer.inputValue(), "Let's work on this");
  assert.equal(
    await composer.evaluate((el) => el === document.activeElement),
    true,
  );
  await composer.press("Enter");
  const card = chat
    .locator(".chat-message")
    .last()
    .getByRole("button", { name: /Research sprint plan/ });
  await card.waitFor();
  assert.match(await card.innerText(), /Ideas & Projects/);
  await card.click();
  await page
    .getByRole("dialog", { name: "Research sprint plan", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".breadcrumbs strong").innerText(),
    "Ideas & Projects",
  );
  await page.getByLabel("Close dialog", { exact: true }).click();
  await chat
    .getByRole("button", { name: "Share from Idea Hub", exact: true })
    .click();
  await chat.getByLabel("Search Idea Hub entries").fill("Claude");
  await chat
    .getByRole("button", { name: "Claude · AI Library", exact: true })
    .click();
  await chat.getByRole("button", { name: /^Send/ }).click();
  const latest = chat.locator(".chat-message").last();
  await latest.getByRole("button", { name: /Claude/ }).click();
  await page.getByRole("dialog", { name: "Claude", exact: true }).waitFor();
  assert.equal(
    await page.locator(".breadcrumbs strong").innerText(),
    "AI Library",
  );
  await page.getByLabel("Close dialog", { exact: true }).click();
  console.log(
    "PASS searchable sharing lists both sections, keyboard selection works, and idea/library cards open their original section",
  );

  const add = latest.getByLabel("Add reaction to message from You", {
    exact: true,
  });
  await add.click();
  let popover = chat.getByRole("dialog", {
    name: "Choose a reaction",
    exact: true,
  });
  assert.equal(await popover.getByRole("button").count(), 6);
  assert.equal(
    await popover
      .getByRole("button")
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await popover.count(), 0);
  let badge = latest.getByRole("button", { name: /^Toggle ❤️ reaction/ });
  assert.equal(await badge.getAttribute("aria-pressed"), "true");
  assert.match(await badge.innerText(), /1/);
  await badge.click();
  assert.equal(await badge.count(), 0);
  await add.click();
  await composer.click();
  assert.equal(await popover.count(), 0);
  await add.click();
  await page.keyboard.press("Escape");
  assert.equal(await popover.count(), 0);
  assert.equal(await add.evaluate((el) => el === document.activeElement), true);
  assert.equal(await chat.isVisible(), true);
  // Existing reactions remain compact badges and can include the current user.
  const sample = chat.locator(".chat-message").nth(1);
  badge = sample.getByRole("button", { name: /^Toggle 🚀 reaction/ });
  await badge.click();
  assert.match(await badge.innerText(), /2/);
  await badge.click();
  assert.match(await badge.innerText(), /1/);
  console.log(
    "PASS reaction popovers support keyboard selection, counts, toggles, outside dismissal, Escape and focus restoration",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await latest
    .getByLabel("Add reaction to message from You", { exact: true })
    .click();
  popover = chat.getByRole("dialog", {
    name: "Choose a reaction",
    exact: true,
  });
  const bounds = await popover.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 390 &&
      bounds.y + bounds.height <= 844,
  );
  await popover
    .getByLabel("React 💡 to message from You", { exact: true })
    .click();
  assert.equal(await popover.count(), 0);
  await chat
    .getByRole("button", { name: "Share from Idea Hub", exact: true })
    .click();
  const mobilePicker = chat.getByRole("dialog", {
    name: "Share from Idea Hub",
    exact: true,
  });
  const box = await mobilePicker.boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 390 &&
      box.y + box.height <= 844,
  );
  await page.keyboard.press("Escape");
  assert.equal(await mobilePicker.count(), 0);
  assert.equal(await chat.isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS mobile picker/reaction popovers fit the viewport and Escape dismisses only the popover",
  );
} catch (error) {
  console.error(
    "Last message:",
    await page.locator(".chat-message").last().innerText(),
  );
  console.error(
    "Focused control:",
    await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 600)),
  );
  throw error;
} finally {
  await browser.close();
}

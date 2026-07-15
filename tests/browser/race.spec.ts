import { expect, Locator, test } from "@playwright/test";

test("two players can complete a race and render a nonblank Three.js canvas", async ({ browser }) => {
  const hostPage = await browser.newPage();
  const guestPage = await browser.newPage();

  await hostPage.goto("/");
  await expect(hostPage.locator("canvas")).toBeVisible();
  await expectCanvasToRender(hostPage.locator("canvas"));

  await hostPage.getByPlaceholder("ADA").fill("Host");
  await hostPage.getByRole("button", { name: "Open Channel" }).click();
  const code = await hostPage.locator(".room-code").textContent();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  const hostLobbyCanvas = hostPage.locator(".lobby-canvas");
  await expectLobbyCanvas(hostLobbyCanvas);
  await hostLobbyCanvas.evaluate((canvas: HTMLCanvasElement) => {
    canvas.dataset.sceneInstance = "retained";
  });

  await guestPage.goto("/");
  await guestPage.getByPlaceholder("ADA").fill("Guest");
  await guestPage.getByPlaceholder("A7K2Q").fill(code ?? "");
  await guestPage.getByRole("button", { name: "Join Channel" }).click();
  await expect(guestPage.locator(".lobby-canvas")).toBeVisible();
  await expectLobbyCanvas(guestPage.locator(".lobby-canvas"));
  await expect(hostPage.locator(".player-row")).toHaveCount(2);
  await expect(hostPage.locator('.lobby-canvas[data-scene-instance="retained"]')).toHaveCount(1);
  await guestPage.getByRole("button", { name: "Sync" }).click();
  await expect(hostPage.locator('.player-row[data-state="synced"]')).toHaveCount(1);
  await hostPage.getByRole("button", { name: "Launch" }).click();

  await expect(hostPage.locator(".countdown-overlay")).toBeVisible();
  await expect(guestPage.locator(".countdown-overlay")).toBeVisible();
  await expect(hostPage.locator("#typingInput")).toBeDisabled();
  await expect(hostPage.locator("#typingInput")).toBeEnabled({ timeout: 5_000 });
  await expect(hostPage.locator(".lane-rank")).toHaveCount(2);

  await expect(hostPage.locator("canvas")).toBeVisible();
  await expectCanvasToRender(hostPage.locator("canvas"));

  const passage = await hostPage.locator("#passage").innerText();
  await guestPage.locator("#typingInput").fill(passage.slice(0, 12));
  await expect(hostPage.locator("#raceAlert")).toContainText("RIVAL PASSED");
  await hostPage.locator("#typingInput").fill("x");
  await expect(hostPage.locator("#raceAlert")).toContainText("SIGNAL BREAK");
  await hostPage.locator("#typingInput").fill("");
  await hostPage.locator("#typingInput").fill(passage);
  await expect(hostPage.locator("#flowStats")).toContainText("flow 3");
  await expect(hostPage.locator("#raceAlert")).toContainText("OVERTAKE");
  await expect(hostPage.locator("#finishWatch")).toBeVisible();
  await expect(hostPage.locator("#finishPlace")).toHaveText("Position #1");
  await expect(hostPage.locator("#finishDeadline")).toContainText("until grid closes");
  await guestPage.locator("#typingInput").fill(passage);
  await expect(hostPage.getByRole("heading", { name: "Readout" })).toBeVisible();
  await expect(hostPage.getByText("Heat 1 complete", { exact: false })).toBeVisible();

  for (const heat of [2, 3]) {
    await hostPage.getByRole("button", { name: "Next Heat" }).click();
    await expect(hostPage.locator("#typingInput")).toBeEnabled({ timeout: 5_000 });
    await expect(hostPage.locator(".race-meta")).toContainText(`${heat} / 3`);
    const nextPassage = await hostPage.locator("#passage").innerText();
    await hostPage.locator("#typingInput").fill(nextPassage);
    await guestPage.locator("#typingInput").fill(nextPassage);
    await expect(hostPage.getByRole("heading", { name: "Readout" })).toBeVisible();
  }

  await expect(hostPage.getByText("Match complete", { exact: false })).toBeVisible();
  await expect(hostPage.locator(".result-points").first()).toContainText("PTS");
});

async function expectCanvasToRender(locator: Locator): Promise<void> {
  await expect.poll(() => hasVisiblePixels(locator), { timeout: 5_000 }).toBe(true);
}

async function expectLobbyCanvas(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCount(1);
  await expectCanvasToRender(locator);
  const dimensions = await locator.evaluate((canvas: HTMLCanvasElement) => ({
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight
  }));
  expect(dimensions.backingWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
  expect(dimensions.backingHeight).toBeGreaterThanOrEqual(dimensions.clientHeight);
}

async function hasVisiblePixels(locator: Locator): Promise<boolean> {
  return locator.evaluate((canvas: HTMLCanvasElement) => {
    const sample = document.createElement("canvas");
    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context || canvas.width < 10 || canvas.height < 10) return false;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let min = 255;
    let max = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return max - min > 20;
  });
}

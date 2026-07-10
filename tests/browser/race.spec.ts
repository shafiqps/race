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

  await guestPage.goto("/");
  await guestPage.getByPlaceholder("ADA").fill("Guest");
  await guestPage.getByPlaceholder("A7K2Q").fill(code ?? "");
  await guestPage.getByRole("button", { name: "Join Channel" }).click();
  await guestPage.getByRole("button", { name: "Sync" }).click();
  await hostPage.getByRole("button", { name: "Launch" }).click();

  await expect(hostPage.locator("canvas")).toBeVisible();
  await expectCanvasToRender(hostPage.locator("canvas"));

  const passage = await hostPage.locator("#passage").innerText();
  await hostPage.locator("#typingInput").fill(passage);
  await guestPage.locator("#typingInput").fill(passage);
  await expect(hostPage.getByRole("heading", { name: "Readout" })).toBeVisible();
});

async function expectCanvasToRender(locator: Locator): Promise<void> {
  await expect.poll(() => hasVisiblePixels(locator), { timeout: 5_000 }).toBe(true);
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

import { test, expect } from "@playwright/test";
import { clearAppState, downloadWorkbook } from "./helpers";

function itemCard(page: import("@playwright/test").Page, exactItemName: string) {
  return page
    .locator("h4", { hasText: exactItemName })
    .locator("xpath=ancestor::div[contains(@class,'lg:col-span-7')][1]");
}

test.describe("複数項目をまとめる（グループ化）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAppState(page);
    await page.reload({ waitUntil: "networkidle" });
  });

  test("同じ区分・同じ判定の項目はまとめられ、1行の特記文として出力される", async ({ page }) => {
    await itemCard(page, "1-1 寝返り").locator('button:has-text("2.見守り等")').click();
    await itemCard(page, "1-2 起き上がり").locator('button:has-text("2.見守り等")').click();

    await itemCard(page, "1-1 寝返り").locator('label:has-text("まとめる") input[type="checkbox"]').click();
    await itemCard(page, "1-2 起き上がり").locator('label:has-text("まとめる") input[type="checkbox"]').click();

    await page.locator('button:has-text("まとめて特記文にする")').click();

    const textarea = page.locator('textarea[placeholder="複数項目をまとめた特記事項を入力"]').first();
    await textarea.fill("寝返り・起き上がりともに見守りを要する。");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /認定調査票\(特記事項\)をExcelで出力/ }).click(),
    ]);
    const wb = await downloadWorkbook(download);
    const ws = wb.getWorksheet("特記事項")!;
    expect(ws.getCell(5, 3).value).toBe("( 1-1,2 )");
    expect(ws.getCell(5, 5).value).toBe("寝返り・起き上がりともに見守りを要する。");
  });

  test("区分（群）が異なる項目はまとめられず、警告が表示される", async ({ page }) => {
    await itemCard(page, "1-11 じょくそう（褥瘡）").locator('button:has-text("ある")').click();
    await itemCard(page, "5-4 ストーマの処置").locator('button:has-text("ある")').click();

    await itemCard(page, "1-11 じょくそう（褥瘡）").locator('label:has-text("まとめる") input[type="checkbox"]').click();
    await itemCard(page, "5-4 ストーマの処置").locator('label:has-text("まとめる") input[type="checkbox"]').click();

    await expect(page.getByText("区分（群）をまたいだ項目はまとめられません")).toBeVisible();
    await expect(page.getByText("1件を選択中")).toBeVisible();
  });
});

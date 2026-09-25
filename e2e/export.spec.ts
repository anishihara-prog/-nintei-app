import { test, expect } from "@playwright/test";
import { setAppState, clearAppState, downloadWorkbook } from "./helpers";

test.describe("特記事項・調査票のExcel出力", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAppState(page);
  });

  test("項目を選択して特記文を入力すると、特記事項.xlsxに正しく出力される", async ({ page }) => {
    await setAppState(page, {
      selections: { "1-1": "2.見守り等" },
      notes: { "1-1": "夜間、見守りを行っている。" },
      subjectName: "E2Eテスト太郎",
    });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /認定調査票\(特記事項\)をExcelで出力/ }).click(),
    ]);

    const wb = await downloadWorkbook(download);
    const ws = wb.getWorksheet("特記事項")!;
    expect(ws.getCell(5, 3).value).toBe("( 1-1 )");
    expect(ws.getCell(5, 5).value).toBe("夜間、見守りを行っている。");
  });

  test("項目を選択すると、認定調査票.xlsmの調査票シートに正しく出力される", async ({ page }) => {
    await setAppState(page, {
      selections: { "1-1": "2.見守り等" },
    });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /調査票（判定一覧）をExcelで出力/ }).click(),
    ]);

    const wb = await downloadWorkbook(download);
    const ws = wb.getWorksheet("調査票")!;
    expect(ws.getCell(27, 3).value).toBe("見守り等の支援が必要");
  });
});

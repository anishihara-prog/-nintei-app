import { test, expect } from "@playwright/test";
import { setAppState, clearAppState, downloadWorkbook } from "./helpers";

test.describe("記入欄の動的な行追加（データ欠損の回帰テスト）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAppState(page);
  });

  test("「5.特別な医療」区分（記入欄2行）に4件分入力しても、アラートなしで全件出力される", async ({ page }) => {
    const dialogMessages: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.accept();
    });

    await setAppState(page, {
      selections: { "5-1": "ある", "5-2": "ある", "5-5": "ある", "5-6": "ある", "5-7": "ある" },
      notes: {
        "5-1": "点滴を管理している。",
        "5-2": "中心静脈栄養を行っている。",
        "5-5": "酸素療法を行っている。",
      },
      groups: [
        { id: "group-5-6_5-7", itemIds: ["5-6", "5-7"], text: "レスピレーターと気管切開の処置を行っている。" },
      ],
    });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /特記事項をExcelで出力/ }).click(),
    ]);

    expect(dialogMessages).toEqual([]); // 記入欄不足のアラートが出ないこと

    const wb = await downloadWorkbook(download);
    const ws = wb.getWorksheet("特記事項")!;
    expect(ws.rowCount).toBeGreaterThan(45); // 行が追加されている

    const texts: string[] = [];
    for (let r = 39; r <= ws.rowCount; r++) {
      if (String(ws.getCell(r, 3).value ?? "").includes("確認できた事項")) break;
      const v = ws.getCell(r, 5).value;
      if (v) texts.push(String(v));
    }
    expect(texts).toEqual([
      "点滴を管理している。",
      "中心静脈栄養を行っている。",
      "酸素療法を行っている。",
      "レスピレーターと気管切開の処置を行っている。",
    ]);
  });
});

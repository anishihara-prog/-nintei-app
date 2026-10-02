import { describe, it, expect, afterEach } from "vitest";
import { exportAssessmentToExcel } from "../../src/exportExcel";
import { ASSESSMENT_ITEMS } from "../../src/App";
import { mockBrowserExportEnvironment } from "./testUtils";

const BASELINE: Record<string, string> = Object.fromEntries(
  ASSESSMENT_ITEMS.map((item: { id: string; options: string[] }) => [item.id, item.options[0]])
);

describe("exportAssessmentToExcel（特記事項.xlsx）", () => {
  it("通常のケース（テンプレートの記入欄に収まる）では、行を増やさずそのまま出力する", async () => {
    const env = mockBrowserExportEnvironment();
    try {
      const selections = { ...BASELINE, "1-1": "2.見守り等" };
      await exportAssessmentToExcel({
        items: ASSESSMENT_ITEMS,
        selections,
        editedNotes: { "1-1": "見守りが必要。" },
        groups: [],
        baselineByItemId: BASELINE,
        subjectName: "テスト太郎",
      });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("特記事項")!;

      expect(ws.rowCount).toBe(45); // 元テンプレートのまま（行追加なし）
      expect(ws.getCell(5, 3).value).toBe("( 1-1 )");
      expect(ws.getCell(5, 5).value).toBe("見守りが必要。");
      expect(ws.getCell(2, 12).value).toBe("テスト太郎"); // 対象者氏名
    } finally {
      env.restore();
    }
  });

  it("グループ化した項目は1行にまとめて出力される", async () => {
    const env = mockBrowserExportEnvironment();
    try {
      const selections = { ...BASELINE, "1-4": "2.見守り等", "1-5": "2.見守り等" };
      await exportAssessmentToExcel({
        items: ASSESSMENT_ITEMS,
        selections,
        editedNotes: {},
        groups: [{ itemIds: ["1-4", "1-5"], text: "移乗・立ち上がりともに見守りを要する。" }],
        baselineByItemId: BASELINE,
      });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("特記事項")!;

      expect(ws.getCell(5, 3).value).toBe("( 1-4,5 )");
      expect(ws.getCell(5, 5).value).toBe("移乗・立ち上がりともに見守りを要する。");
    } finally {
      env.restore();
    }
  });

  it("区分内の出力順は、UI表示順（調査票の出現順）ではなく項目番号の昇順になる", async () => {
    // ASSESSMENT_ITEMS（UI表示順）では1群が 1-1,1-2,1-3,1-6,...,1-11,1-12,1-4,... という
    // 実際の調査票の出現順になっているため、そのまま出力すると1-1,1-11,1-4の順になって
    // しまう。特記事項.xlsxへの出力は項目番号の昇順（1-1,1-4,1-11）にする。
    const env = mockBrowserExportEnvironment();
    try {
      const selections = { ...BASELINE, "1-1": "2.見守り等", "1-11": "ある", "1-4": "2.見守り等" };
      const editedNotes = { "1-1": "寝返りの特記。", "1-11": "じょくそうの特記。", "1-4": "移乗の特記。" };

      await exportAssessmentToExcel({
        items: ASSESSMENT_ITEMS,
        selections,
        editedNotes,
        groups: [],
        baselineByItemId: BASELINE,
      });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("特記事項")!;

      expect(ws.getCell(5, 3).value).toBe("( 1-1 )");
      expect(ws.getCell(5, 5).value).toBe("寝返りの特記。");
      expect(ws.getCell(6, 3).value).toBe("( 1-4 )");
      expect(ws.getCell(6, 5).value).toBe("移乗の特記。");
      expect(ws.getCell(7, 3).value).toBe("( 1-11 )");
      expect(ws.getCell(7, 5).value).toBe("じょくそうの特記。");
    } finally {
      env.restore();
    }
  });

  it("区分の記入欄を超える件数がある場合、行を動的に追加してすべて出力する（データ欠損なし）", async () => {
    const env = mockBrowserExportEnvironment();
    try {
      // 「5.特別な医療」は元テンプレートの記入欄が2行しかない区分。4件分入れて超過させる。
      const selections = {
        ...BASELINE,
        "5-1": "ある",
        "5-2": "ある",
        "5-5": "ある",
        "5-6": "ある",
        "5-7": "ある",
      };
      const editedNotes = {
        "5-1": "点滴を管理している。",
        "5-2": "中心静脈栄養を行っている。",
        "5-5": "酸素療法を行っている。",
      };
      const groups = [{ itemIds: ["5-6", "5-7"], text: "レスピレーターと気管切開の処置を行っている。" }];

      await exportAssessmentToExcel({
        items: ASSESSMENT_ITEMS,
        selections,
        editedNotes,
        groups,
        baselineByItemId: BASELINE,
      });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("特記事項")!;

      expect(ws.rowCount).toBeGreaterThan(45); // 行が追加されている
      // 5群の見出し行（元は38行目）以降、4件すべてが欠落なく出力されているか
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
    } finally {
      env.restore();
    }
  });
});

afterEach(() => {
  // 各テストのfinallyでrestore済みだが、念のため後続テストへの影響がないことを保証
});

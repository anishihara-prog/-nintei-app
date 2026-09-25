// 「調査票シート差異.xlsx」（実際の認定調査票の「調査票」シートと、アプリの項目を
// 突き合わせてユーザーが作成した比較ファイル）から抜き出したデータを正解として、
// 1) 項目の並び順（SURVEY_GROUPS）と 2) 各項目の選択肢配列（アプリ側）が
// 一致し続けることを保証する回帰テスト。
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ASSESSMENT_ITEMS } from "../../src/App";
import { SURVEY_GROUPS } from "../../src/exportSurveySheet";

type ReferenceRow = { r: number; id: string; name: string; opts: string[] };

const reference: ReferenceRow[] = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/survey-sheet-reference.json"), "utf8")
);

describe("項目の並び順（SURVEY_GROUPS）", () => {
  it("実際の調査票シートの出現順（80項目）と完全に一致する", () => {
    const flattenedIds = SURVEY_GROUPS.flatMap(g => g.itemIds);
    expect(flattenedIds).toEqual(reference.map(r => r.id));
  });

  it("重複・欠落がない（80項目ちょうど）", () => {
    const flattenedIds = SURVEY_GROUPS.flatMap(g => g.itemIds);
    expect(flattenedIds.length).toBe(80);
    expect(new Set(flattenedIds).size).toBe(80);
  });
});

describe("アプリのUI表示順（ASSESSMENT_ITEMS）", () => {
  it("SURVEY_GROUPSの並び順と完全に一致する", () => {
    const appOrder = ASSESSMENT_ITEMS.map((item: { id: string }) => item.id);
    const surveyOrder = SURVEY_GROUPS.flatMap(g => g.itemIds);
    expect(appOrder).toEqual(surveyOrder);
  });
});

describe("各項目の選択肢（アプリのoptions配列）", () => {
  const byId = new Map(ASSESSMENT_ITEMS.map((item: { id: string; options: string[] }) => [item.id, item.options]));

  it.each(reference)("$id ($name) の選択肢数が実際の調査票と一致する", (row) => {
    const options = byId.get(row.id);
    expect(options).toBeDefined();
    // 参照データの最後尾にある全角スペース等の空欄プレースホルダーは除く
    const realOptsCount = row.opts.filter(o => o.trim() !== "").length;
    expect(options!.length).toBe(realOptsCount);
  });
});

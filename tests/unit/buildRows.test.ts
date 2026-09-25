import { describe, it, expect } from "vitest";
import { buildRows, type ExportItem, type ExportGroup } from "../../src/exportExcel";

const CATEGORY = "1.移動や動作等";
const ITEMS: ExportItem[] = [
  { id: "1-1", category: CATEGORY, name: "1-1 寝返り" },
  { id: "1-2", category: CATEGORY, name: "1-2 起き上がり" },
  { id: "1-3", category: CATEGORY, name: "1-3 座位保持" },
];
const BASELINE = { "1-1": "1.支援不要", "1-2": "1.支援不要", "1-3": "1.支援不要" };

describe("buildRows", () => {
  it("基準値と同じ項目は行を作らない", () => {
    const rows = buildRows(ITEMS, CATEGORY, BASELINE, {}, [], BASELINE);
    expect(rows).toEqual([]);
  });

  it("基準値と異なり特記文がある項目だけ行になる", () => {
    const selections = { ...BASELINE, "1-1": "2.見守り等" };
    const notes = { "1-1": "見守りが必要。" };
    const rows = buildRows(ITEMS, CATEGORY, selections, notes, [], BASELINE);
    expect(rows).toEqual([{ ids: ["1-1"], label: "( 1-1 )", text: "見守りが必要。" }]);
  });

  it("基準値と異なるが特記文が空の項目は行にならない", () => {
    const selections = { ...BASELINE, "1-1": "2.見守り等" };
    const rows = buildRows(ITEMS, CATEGORY, selections, {}, [], BASELINE);
    expect(rows).toEqual([]);
  });

  it("グループ化された項目は1行にまとめられ、グループのtextが使われる", () => {
    const selections = { ...BASELINE, "1-1": "2.見守り等", "1-2": "2.見守り等" };
    const groups: ExportGroup[] = [{ itemIds: ["1-1", "1-2"], text: "まとめた特記文。" }];
    const rows = buildRows(ITEMS, CATEGORY, selections, {}, groups, BASELINE);
    expect(rows).toEqual([{ ids: ["1-1", "1-2"], label: "( 1-1,2 )", text: "まとめた特記文。" }]);
  });

  it("グループのtextが空なら行にならない（個別項目としても出力しない）", () => {
    const selections = { ...BASELINE, "1-1": "2.見守り等", "1-2": "2.見守り等" };
    const groups: ExportGroup[] = [{ itemIds: ["1-1", "1-2"], text: "" }];
    const rows = buildRows(ITEMS, CATEGORY, selections, {}, groups, BASELINE);
    expect(rows).toEqual([]);
  });

  it("グループ化された項目と個別項目が混在する場合、それぞれ正しく1行ずつになる", () => {
    const selections = { ...BASELINE, "1-1": "2.見守り等", "1-2": "2.見守り等", "1-3": "3.部分支援" };
    const notes = { "1-3": "部分的な支援が必要。" };
    const groups: ExportGroup[] = [{ itemIds: ["1-1", "1-2"], text: "まとめた特記文。" }];
    const rows = buildRows(ITEMS, CATEGORY, selections, notes, groups, BASELINE);
    expect(rows).toEqual([
      { ids: ["1-1", "1-2"], label: "( 1-1,2 )", text: "まとめた特記文。" },
      { ids: ["1-3"], label: "( 1-3 )", text: "部分的な支援が必要。" },
    ]);
  });
});

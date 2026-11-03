import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { exportAssessmentToExcel } from "../../src/exportExcel";

const CATEGORIES = ["1.移動や動作等", "2.日常生活等", "3.意思疎通等", "4.行動障害等", "5.特別な医療"];

describe("exportAssessmentToExcel perimeter borders", () => {
  it("keeps medium left/right borders on every row including section heading rows", async () => {
    const template = readFileSync("public/templates/特記事項入力シート.xlsx");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      arrayBuffer: async () => template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength),
    }));
    let captured: Blob | undefined;
    URL.createObjectURL = ((b: Blob) => { captured = b; return "blob:x"; }) as any;
    URL.revokeObjectURL = (() => {}) as any;
    HTMLAnchorElement.prototype.click = () => {};

    const items: { id: string; category: string; name: string }[] = [];
    const selections: Record<string, string> = {};
    const editedNotes: Record<string, string> = {};
    const baselineByItemId: Record<string, string> = {};
    CATEGORIES.forEach((category, ci) => {
      for (let n = 1; n <= 12; n++) {
        const id = `${ci + 1}-${n}`;
        items.push({ id, category, name: `項目${id}` });
        selections[id] = "要支援";
        baselineByItemId[id] = "支援不要";
        editedNotes[id] = `特記事項${id}`;
      }
    });

    await exportAssessmentToExcel({ items, selections, editedNotes, groups: [], baselineByItemId });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await captured!.arrayBuffer());
    const ws = wb.getWorksheet("特記事項")!;
    const lastRow = Number(ws.pageSetup.printArea!.match(/(\d+)$/)![1]);

    const otherMerge = (ws.model as any).merges.find((m: string) => /^B\d+:B\d+$/.test(m) && Number(m.match(/^B(\d+)/)![1]) > 60) as string;
    expect(ws.pageSetup.printArea).toBe(`B2:N${otherMerge.split(":")[1].slice(1)}`);

    const missing: string[] = [];
    for (let row = 4; row <= lastRow; row++) {
      if (ws.getCell(row, 2).border?.left?.style !== "medium") missing.push(`B${row}`);
      if (ws.getCell(row, 14).border?.right?.style !== "medium") missing.push(`N${row}`);
    }
    expect(missing).toEqual([]);
  });
});

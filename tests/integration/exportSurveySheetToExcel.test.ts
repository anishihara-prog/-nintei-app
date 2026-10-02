// 「調査票シート差異.xlsx」から抜き出した実データ（各項目の正しい選択肢表示文言と
// 出現順）を正解として、exportSurveySheetToExcelが実際に生成する「調査票」シートの
// 内容が全80項目・全行で一致することを検証する回帰テスト。
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { exportSurveySheetToExcel } from "../../src/exportSurveySheet";
import { ASSESSMENT_ITEMS } from "../../src/App";
import { mockBrowserExportEnvironment } from "./testUtils";

type ReferenceRow = { r: number; id: string; name: string; opts: string[] };

const reference: ReferenceRow[] = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/survey-sheet-reference.json"), "utf8")
);

const optionsById = new Map(
  ASSESSMENT_ITEMS.map((item: { id: string; options: string[] }) => [item.id, item.options])
);

describe("exportSurveySheetToExcel（認定調査票.xlsm）", () => {
  it("全80項目について、選択肢を2番目にした場合に正しい行・正しい表示文言で転記される", async () => {
    const env = mockBrowserExportEnvironment();
    try {
      const selections: Record<string, string> = {};
      for (const row of reference) {
        const options = optionsById.get(row.id)!;
        selections[row.id] = options[1] ?? options[0];
      }

      await exportSurveySheetToExcel({ items: ASSESSMENT_ITEMS, selections });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("調査票")!;

      for (const row of reference) {
        const expectedText = row.opts[1];
        const actual = String(ws.getCell(row.r, 3).value ?? "").trim();
        expect(actual, `${row.id}（${row.name}, row${row.r}）`).toBe(expectedText);
      }
    } finally {
      env.restore();
    }
  });

  it("D列のキャッシュされた数式結果（MATCH結果）も、選んだ選択肢の位置に正しく更新される", async () => {
    // D列（=MATCH(C列,選択肢範囲,0)）の計算結果は「調査票提出用」シートのマクロが参照して
    // 枠の表示切替を行っている。ExcelJSは数式を再計算しないため、C列だけ書き換えても
    // このキャッシュされた結果が古いままだと「調査票提出用」に反映されない回帰バグがあった。
    const env = mockBrowserExportEnvironment();
    try {
      const selections: Record<string, string> = {};
      for (const row of reference) {
        const options = optionsById.get(row.id)!;
        selections[row.id] = options[1] ?? options[0];
      }

      await exportSurveySheetToExcel({ items: ASSESSMENT_ITEMS, selections });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("調査票")!;

      for (const row of reference) {
        const realOpts = row.opts.filter(o => o.trim() !== "");
        const expectedIndex = realOpts.indexOf(row.opts[1]) + 1; // 1始まり
        const dCell = ws.getCell(row.r, 4);
        expect(dCell.result, `${row.id}（${row.name}, row${row.r}）のD列`).toBe(expectedIndex);
      }
    } finally {
      env.restore();
    }
  });

  it("調査票提出用シートの図形（四角形の枠）が、ExcelJSの書き出しを経ても失われない", async () => {
    // ExcelJSは書き出し時にオートシェイプ（四角形などの図形）を保持できず、
    // 埋め込み画像だけが残って判定結果を示す枠が消えてしまう回帰バグがあった
    // （xlsmMacroRepair.tsのrepairXlsmMacroで元ファイルの図形定義を再注入して復元している）。
    const env = mockBrowserExportEnvironment();
    try {
      await exportSurveySheetToExcel({ items: ASSESSMENT_ITEMS, selections: {} });
      const buffer = await env.getCapturedBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const drawing = await zip.file("xl/drawings/drawing1.xml")?.async("string");
      expect(drawing).toBeDefined();
      const shapeNames = drawing!.match(/四角形 \d+/g) || [];
      expect(shapeNames.length).toBeGreaterThan(300); // 実ファイルには312個の枠が存在する
    } finally {
      env.restore();
    }
  });

  it("各シートのcodeNameが、ExcelJSの書き出しを経ても失われない", async () => {
    // ExcelJSは書き出し時に各シートのcodeName（<sheetPr codeName="Sheet2"/>等）を
    // 失ってしまう回帰バグがあった。codeNameが無いと、VBAコード内の
    // 「Sheet2.Range(...)」のようなシート参照をExcelが解決できず、実行時エラー429
    // 「ActiveXコンポーネントはオブジェクトを作成できません」になり、マクロが
    // 一切動かなくなる（xlsmMacroRepair.tsのrepairXlsmMacroで、シート名を手がかりに
    // 元ファイルからcodeNameを復元している）。
    const env = mockBrowserExportEnvironment();
    try {
      await exportSurveySheetToExcel({ items: ASSESSMENT_ITEMS, selections: {} });
      const buffer = await env.getCapturedBuffer();
      const zip = await JSZip.loadAsync(buffer);

      const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
      const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
      const targetById = new Map(
        [...relsXml.matchAll(/<Relationship\b[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]])
      );

      const nameToCodeName = new Map<string, string | undefined>();
      for (const tag of workbookXml.match(/<sheet\b[^>]*\/>/g) || []) {
        const name = tag.match(/name="([^"]+)"/)?.[1];
        const rId = tag.match(/r:id="(rId\d+)"/)?.[1];
        const target = rId ? targetById.get(rId) : undefined;
        if (!name || !target) continue;
        const sheetXml = await zip.file(`xl/${target}`)?.async("string");
        nameToCodeName.set(name, sheetXml?.match(/codeName="([^"]*)"/)?.[1]);
      }

      expect(nameToCodeName.get("調査票")).toBe("Sheet2");
      expect(nameToCodeName.get("調査票提出用")).toBe("Sheet4");
      for (const [name, codeName] of nameToCodeName) {
        expect(codeName, `シート「${name}」のcodeName`).toBeDefined();
      }
    } finally {
      env.restore();
    }
  });

  it("項目IDと無関係に、選択肢1番目（基準値）でも正しい行に転記される", async () => {
    const env = mockBrowserExportEnvironment();
    try {
      const selections: Record<string, string> = {};
      for (const row of reference) {
        const options = optionsById.get(row.id)!;
        selections[row.id] = options[0];
      }

      await exportSurveySheetToExcel({ items: ASSESSMENT_ITEMS, selections });
      const wb = await env.getCapturedWorkbook();
      const ws = wb.getWorksheet("調査票")!;

      for (const row of reference) {
        const expectedText = row.opts[0];
        const actual = String(ws.getCell(row.r, 3).value ?? "").trim();
        expect(actual, `${row.id}（${row.name}, row${row.r}）`).toBe(expectedText);
      }
    } finally {
      env.restore();
    }
  });
});

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { repairXlsmMacro } from "./xlsmMacroRepair";

// -------------------------------------------------------
// 実ファイル「認定調査票.xlsm」（public/templates/に同梱）をテンプレートとして
// そのまま読み込み、「調査票」シートのC27〜C106（基本調査80項目）だけを埋めて
// 書き出す。医師意見書由来の項目（1〜26行目）はアプリ側にデータがないため対象外。
// D列・E列の数式や他シート（判定ロジック・配点表等）はテンプレートのまま保持され、
// 実ファイルを開けば既存の数式が自動で計算される。
// VBAマクロ（vbaProject.bin）はExcelJSの読み書きで失われるため、
// repairXlsmMacroで元ファイルから復元して埋め込む。
// -------------------------------------------------------

const TEMPLATE_URL = "/templates/認定調査票.xlsm";

export type ExportItem = { id: string; category: string; name: string };

export type SurveyGroup = { label: string; itemIds: string[] };

// 実ファイルの27〜106行目の並び・群分け（実ファイルを直接読み合わせて検証済み）
export const SURVEY_GROUPS: SurveyGroup[] = [
  { label: "起居動作", itemIds: ["1-1", "1-2", "1-3", "1-6", "1-8", "1-5", "1-7"] },
  { label: "生活機能１（食事・排泄等）", itemIds: ["1-11", "1-12", "2-1", "2-4", "2-5"] },
  { label: "生活機能２（移動・清潔等）", itemIds: ["1-4", "1-9", "2-3", "2-2", "1-10", "2-6"] },
  { label: "視聴覚機能", itemIds: ["3-1", "3-2"] },
  { label: "応用日常生活動作", itemIds: ["2-12", "2-13", "2-14", "2-15", "2-16"] },
  { label: "認知機能", itemIds: ["2-7", "2-8", "2-9", "2-10", "3-5", "2-11", "3-3", "3-4"] },
  {
    label: "行動上の障害（A群）",
    itemIds: [
      "4-1", "4-2", "4-3", "4-4", "4-5", "4-6", "4-7", "4-8", "4-9", "4-10",
      "4-11", "4-12", "4-13", "4-14", "4-15", "4-16", "4-17", "4-33",
    ],
  },
  {
    label: "行動上の障害（B群）",
    itemIds: ["4-18", "4-19", "4-20", "4-21", "4-22", "4-23", "4-24", "4-25", "4-34", "4-27", "3-6"],
  },
  { label: "行動上の障害（C群）", itemIds: ["4-26", "4-28", "4-29", "4-30", "4-31", "4-32"] },
  {
    label: "特別な医療",
    itemIds: ["5-1", "5-2", "5-3", "5-4", "5-5", "5-6", "5-7", "5-8", "5-9", "5-10", "5-11", "5-12"],
  },
];

const SURVEY_START_ROW = 27;
const SURVEY_ORGANIZATION = "北区障害者基幹相談支援センター";
const ORGANIZATION_TEXT_BOX_EXTRA_WIDTH_EMU = 280_000;
// 背景画像の枠を実測すると、1ページ目（5行目）の所属機関欄だけ他ページより狭く、
// 10pt・16文字の文字列がほぼ枠幅いっぱいになる。右へ寄せると枠線を越えるため、
// 1ページ目は左へ寄せる（10pt全角2文字分=約254,000EMUを追加で左へ）。
const ORGANIZATION_TEXT_BOX_SHIFT_EMU_BY_ROW: Record<number, number> = { 3: -289_000 };
// The print sheet uses Excel's default column width of 64 px.
const TEMPLATE_DEFAULT_COLUMN_WIDTH_EMU = 609_600;

const PRINT_HEADER_FIELDS = [
  { field: "surveyorNumber", row: 3, col: 1 },
  { field: "organization", row: 3, col: 4 },
  { field: "subjectName", row: 5, col: 1 },
  { field: "surveyorNumber", row: 66, col: 1 },
  { field: "organization", row: 66, col: 3 },
  { field: "subjectName", row: 68, col: 1 },
  { field: "surveyorNumber", row: 129, col: 1 },
  { field: "organization", row: 129, col: 3 },
  { field: "subjectName", row: 131, col: 1 },
] as const;

type PrintHeaderField = (typeof PRINT_HEADER_FIELDS)[number]["field"];

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setTextBodyFontSize(textBody: string, fontSize: number): string {
  return textBody.replace(/<a:(?:rPr|defRPr)\b[^>]*>/g, runProperties => {
    const sizeAttribute = `sz="${fontSize}"`;
    return /\bsz="[^"]*"/.test(runProperties)
      ? runProperties.replace(/\bsz="[^"]*"/, sizeAttribute)
      : runProperties.replace(/>$/, ` ${sizeAttribute}>`);
  });
}

function shiftAnchorMarkerRight(anchor: string, tag: "from" | "to", dxEmu: number): string {
  return anchor.replace(
    new RegExp(`(<xdr:${tag}>\\s*<xdr:col>)(\\d+)(</xdr:col>\\s*<xdr:colOff>)(\\d+)(</xdr:colOff>)`),
    (_match, head: string, col: string, mid: string, off: string, tail: string) => {
      let nextCol = Number(col);
      let nextOff = Number(off) + dxEmu;
      while (nextOff >= TEMPLATE_DEFAULT_COLUMN_WIDTH_EMU) {
        nextOff -= TEMPLATE_DEFAULT_COLUMN_WIDTH_EMU;
        nextCol += 1;
      }
      while (nextOff < 0) {
        nextOff += TEMPLATE_DEFAULT_COLUMN_WIDTH_EMU;
        nextCol -= 1;
      }
      return `${head}${nextCol}${mid}${nextOff}${tail}`;
    }
  );
}

// 右端を広げた上で、全体を左右に動かす（枠線・塗りの無いテキストボックスなので文字位置だけが変わる）
function adjustOrganizationBox(anchor: string, extraWidthEmu: number, shiftEmu: number): string {
  const xfrm = anchor.match(/<a:off x="(\d+)"([^>]*)\/>\s*<a:ext cx="(\d+)"/);
  if (!xfrm) throw new Error("所属機関のテキストボックス幅を読み取れません");

  let adjusted = shiftAnchorMarkerRight(anchor, "from", shiftEmu);
  adjusted = shiftAnchorMarkerRight(adjusted, "to", shiftEmu + extraWidthEmu);
  return adjusted.replace(
    xfrm[0],
    xfrm[0]
      .replace(`<a:off x="${xfrm[1]}"`, `<a:off x="${Number(xfrm[1]) + shiftEmu}"`)
      .replace(`<a:ext cx="${xfrm[3]}"`, `<a:ext cx="${Number(xfrm[3]) + extraWidthEmu}"`)
  );
}

async function fillPrintHeaderFields(
  templateBuffer: ArrayBuffer,
  values: Record<PrintHeaderField, string>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const drawingPath = "xl/drawings/drawing1.xml";
  const drawingFile = zip.file(drawingPath);
  if (!drawingFile) throw new Error("認定調査票テンプレートの印刷用ヘッダーが見つかりません");

  let drawing = await drawingFile.async("string");
  const anchors = [...drawing.matchAll(/<xdr:twoCellAnchor\b[^>]*>[\s\S]*?<\/xdr:twoCellAnchor>/g)];
  const organizationAnchor = anchors.find(([anchor]) => {
    const from = anchor.match(/<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    return from && Number(from[1]) === 4 && Number(from[2]) === 3;
  })?.[0];
  const organizationBody = organizationAnchor?.match(/<xdr:txBody>[\s\S]*?<\/xdr:txBody>/)?.[0];
  if (!organizationBody) throw new Error("認定調査票テンプレートのヘッダー書式を読み取れません");
  const formattedOrganizationBody = setTextBodyFontSize(organizationBody, 1000);

  const counts: Record<PrintHeaderField, number> = {
    surveyorNumber: 0,
    organization: 0,
    subjectName: 0,
  };

  drawing = drawing.replace(
    /<xdr:twoCellAnchor\b[^>]*>[\s\S]*?<\/xdr:twoCellAnchor>/g,
    anchor => {
      const from = anchor.match(/<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      if (!from) return anchor;
      const field = PRINT_HEADER_FIELDS.find(
        candidate => candidate.col === Number(from[1]) && candidate.row === Number(from[2])
      )?.field;
      if (!field) return anchor;

      counts[field] += 1;
      const escapedValue = escapeXmlText(values[field]);
      const shape = anchor.match(/<xdr:sp\b[\s\S]*?<\/xdr:sp>/)?.[0];
      if (!shape) throw new Error(`印刷用ヘッダー（${field}）のテキスト枠が見つかりません`);

      let updatedShape: string;
      if (/<xdr:txBody>[\s\S]*?<\/xdr:txBody>/.test(shape)) {
        updatedShape = shape.replace(/(<a:t>)[\s\S]*?(<\/a:t>)/, `$1${escapedValue}$2`);
        if (field === "organization") {
          updatedShape = updatedShape.replace(
            /<xdr:txBody>[\s\S]*?<\/xdr:txBody>/,
            textBody => setTextBodyFontSize(textBody, 1000)
          );
        }
      } else {
        const sourceBody = field === "organization" ? formattedOrganizationBody : organizationBody;
        const filledBody = sourceBody.replace(/(<a:t>)[\s\S]*?(<\/a:t>)/, `$1${escapedValue}$2`);
        updatedShape = shape.replace("</xdr:sp>", `${filledBody}</xdr:sp>`);
      }
      const updatedAnchor = anchor.replace(shape, updatedShape);
      return field === "organization"
        ? adjustOrganizationBox(
            updatedAnchor,
            ORGANIZATION_TEXT_BOX_EXTRA_WIDTH_EMU,
            ORGANIZATION_TEXT_BOX_SHIFT_EMU_BY_ROW[Number(from[2])] ?? 0
          )
        : updatedAnchor;
    }
  );

  for (const field of ["surveyorNumber", "organization", "subjectName"] as const) {
    if (counts[field] !== 3) {
      throw new Error(`認定調査票の全ページに${field}を設定できませんでした（${counts[field]}/3ページ）`);
    }
  }

  zip.file(drawingPath, drawing);
  return zip.generateAsync({ type: "uint8array" });
}

// アプリ内の選択肢文言 → 実ファイル（調査票シート）の正式な選択肢文言への対応表
// （実ファイルのプルダウン文言を直接読み取り、一言一句突き合わせ済み）
const PATTERN_4WAY: Record<string, string> = {
  "1.支援不要": "できる",
  "2.見守り等": "見守り等の支援が必要",
  "3.部分支援": "部分的な支援や介助が必要",
  "4.全面支援": "全面的な支援や介助が必要",
};
const PATTERN_3WAY: Record<string, string> = {
  "1.支援不要": "できる",
  "2.部分支援": "部分的な支援が必要",
  "3.全面支援": "全面的な支援が必要",
};
const PATTERN_ARINAI: Record<string, string> = { "ない": "ない", "ある": "ある" };
const PATTERN_FREQ5: Record<string, string> = {
  "1.支援不要": "ない",
  "2.希に支援": "希にある",
  "3.月に1回以上支援": "月に１回以上ある",
  "4.週に1回以上支援": "週に１回以上ある",
  "5.ほぼ毎日支援": "ほぼ毎日（週５日以上）ある",
};

const ITEM_OPTION_MAPS: Record<string, Record<string, string>> = {
  "1-11": PATTERN_ARINAI,
  "1-12": { "1.支援不要": "できる", "2.見守り等": "見守り等の支援が必要", "3.全面支援": "できない" },
  "3-1": {
    "生活に支障なし": "日常生活に支障がない",
    "1m先が見える": "約1m離れた視力確認表の図が見える",
    "目の前が見える": "目の前に置いた視力確認表の図が見える",
    "ほとんど見えず": "ほとんど見えていない",
    "全く見えず": "全く見えない",
    "判断不能": "見えているのか判断不能",
  },
  "3-2": {
    "生活に支障なし": "日常生活に支障がない",
    "やっと聞き取れる": "普通の声がやっと聞こえる",
    "大声なら聞こえる": "かなり大きな声なら何とか聞き取れる",
    "ほとんど聞こえず": "ほとんど聞えない",
    "全く聞こえず": "全く聞こえない",
    "判断不能": "聞こえているのか判断不能",
  },
  "3-3": {
    "生活に支障なし": "日常生活に支障がない",
    "特定の者なら可": "特定の者であればコミュニケーションできる",
    "会話以外で可": "会話以外の方法でコミュニケーションできる",
    "独自の方法で可": "独自の方法でコミュニケーションできる",
    "できない": "コミュニケーションできない",
  },
  "3-4": {
    "理解できる": "理解できる",
    "理解できない": "理解できない",
    "判断不能": "理解できているか判断できない",
  },
  "3-5": { "支援不要": "できる", "部分支援": "部分的な支援が必要", "全面支援": "全面的な支援が必要" },
  "3-6": PATTERN_ARINAI,
};
for (let i = 1; i <= 10; i++) ITEM_OPTION_MAPS[`1-${i}`] = PATTERN_4WAY;
for (let i = 1; i <= 16; i++) ITEM_OPTION_MAPS[`2-${i}`] = PATTERN_3WAY;
for (let i = 1; i <= 34; i++) ITEM_OPTION_MAPS[`4-${i}`] = PATTERN_FREQ5;
for (let i = 1; i <= 12; i++) ITEM_OPTION_MAPS[`5-${i}`] = PATTERN_ARINAI;

const OPTIONS_START_COL = 6; // F列（各行の選択肢一覧はF列から始まる。実ファイルを直接確認済み）

// D列には「=MATCH(C列,選択肢範囲,0)」という数式が入っており、選んだ選択肢が
// 選択肢一覧の何番目かを表す数値を返す。この数値を「調査票提出用」シートのマクロ
// （Worksheet_Activate内でSheet2.Range("d行番号")を見て、対応する枠を表示する処理）が
// 参照している。ExcelJSは数式を再計算しないため、C列を書き換えてもD列の
// キャッシュされた計算結果（result）は古いまま残ってしまい、実際にExcelで開いて
// 再計算されるかは環境依存で保証できない。そこでC列と同時に、数式はそのまま残しつつ
// キャッシュされた計算結果だけを正しい値に更新し、「調査票提出用」シートに正しく
// 反映されるようにする。
function updateMatchFormulaCache(ws: ExcelJS.Worksheet, row: number, matchedText: string) {
  const dCell = ws.getCell(row, 4);
  if (dCell.type !== ExcelJS.ValueType.Formula) return;

  for (let col = OPTIONS_START_COL; col < OPTIONS_START_COL + 20; col++) {
    const optionText = ws.getCell(row, col).value;
    if (optionText === matchedText) {
      const index = col - OPTIONS_START_COL + 1;
      (dCell as unknown as { _value: { result: number } })._value.result = index;
      return;
    }
    if (optionText === null || optionText === undefined) break;
  }
}

export async function exportSurveySheetToExcel(params: {
  items: ExportItem[];
  selections: Record<string, string>;
  subjectName?: string;
  surveyorNumber?: string;
  fileName?: string;
}) {
  const { selections, subjectName, surveyorNumber, fileName } = params;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`テンプレートの取得に失敗しました: ${TEMPLATE_URL}`);
  const originalBuffer = await res.arrayBuffer();
  const templateWithHeader = await fillPrintHeaderFields(originalBuffer, {
    surveyorNumber: surveyorNumber?.trim() || "",
    organization: SURVEY_ORGANIZATION,
    subjectName: subjectName?.trim() || "",
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(originalBuffer);
  const ws = wb.getWorksheet("調査票");
  if (!ws) throw new Error("テンプレートに「調査票」シートが見つかりません");

  // 元テンプレートは「調査票提出用」タブ（値の入っていない印刷用シート）が既定表示に
  // なっているため、開いたときに記入済みの「調査票」タブが表示されるよう選択状態を移す。
  // tabSelectedはExcelJSの型定義には無いが、xlsx側は実際にサポートしているプロパティ。
  const surveySheetIndex = wb.worksheets.findIndex(s => s.name === "調査票");
  wb.views = [{ activeTab: surveySheetIndex } as ExcelJS.WorkbookView];
  wb.worksheets.forEach(s => {
    s.views = [{ ...(s.views[0] || {}), tabSelected: s === ws } as unknown as ExcelJS.WorksheetView];
  });

  let r = SURVEY_START_ROW;
  const unmapped: string[] = [];

  for (const group of SURVEY_GROUPS) {
    for (const id of group.itemIds) {
      const status = selections[id];
      const map = ITEM_OPTION_MAPS[id] || {};
      const mapped = status ? map[status] : undefined;
      if (status && mapped === undefined) unmapped.push(`${id}(${status})`);

      if (mapped !== undefined) {
        ws.getCell(r, 3).value = mapped;
        updateMatchFormulaCache(ws, r, mapped);
      }
      r++;
    }
  }

  if (unmapped.length > 0) {
    window.alert(
      `対応表に無い選択肢があったため、C列を変更しなかった項目があります：${unmapped.join("、")}`
    );
  }

  const filledBuffer = await wb.xlsx.writeBuffer();
  const finalBuffer = await repairXlsmMacro(filledBuffer, templateWithHeader);

  const blob = new Blob([finalBuffer as BlobPart], {
    type: "application/vnd.ms-excel.sheet.macroEnabled.12",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || (subjectName ? `${subjectName}　認定調査票.xlsm` : `認定調査票_記入済み_${Date.now()}.xlsm`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

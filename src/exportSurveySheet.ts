import ExcelJS from "exceljs";
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

type SurveyGroup = { label: string; itemIds: string[] };

// 実ファイルの27〜106行目の並び・群分け（実ファイルを直接読み合わせて検証済み）
const SURVEY_GROUPS: SurveyGroup[] = [
  { label: "起居動作", itemIds: ["1-1", "1-2", "1-3", "1-6", "1-8", "1-5", "1-7"] },
  { label: "(生活機能等・排泄1)", itemIds: ["1-11", "1-12", "2-1", "2-4", "2-5"] },
  { label: "生活機能２（移乗・清潔等）", itemIds: ["1-4", "1-9", "2-3", "2-2", "1-10", "2-6"] },
  { label: "視聴覚機能", itemIds: ["3-1", "3-2"] },
  { label: "応用動作日常生活", itemIds: ["2-12", "2-13", "2-14", "2-15", "2-16"] },
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

export async function exportSurveySheetToExcel(params: {
  items: ExportItem[];
  selections: Record<string, string>;
  fileName?: string;
}) {
  const { selections, fileName } = params;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`テンプレートの取得に失敗しました: ${TEMPLATE_URL}`);
  const originalBuffer = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(originalBuffer);
  const ws = wb.getWorksheet("調査票");
  if (!ws) throw new Error("テンプレートに「調査票」シートが見つかりません");

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
  const finalBuffer = await repairXlsmMacro(filledBuffer, originalBuffer);

  const blob = new Blob([finalBuffer as BlobPart], {
    type: "application/vnd.ms-excel.sheet.macroEnabled.12",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `認定調査票_記入済み_${Date.now()}.xlsm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import ExcelJS from "exceljs";

// -------------------------------------------------------
// 実ファイル「特記事項入力シート.xlsx」（public/templates/に同梱）をテンプレートと
// してそのまま読み込み、区分ごとに用意された空欄行（C:D列＝項目番号、E:M列＝
// 特記文、どちらも結合セル）に必要な行だけを埋めて書き出す。
// 罫線・見出し・群ラベル・セル結合・プルダウン検証は元テンプレートに既に
// 用意されているため、ここでは値の書き込みのみ行う。
// このファイルにマクロは含まれないため、xlsmMacroRepairは不要。
// -------------------------------------------------------

const TEMPLATE_URL = "/templates/特記事項入力シート.xlsx";

export type ExportItem = { id: string; category: string; name: string };
export type ExportGroup = { itemIds: string[]; text: string };

const ID_COL_FROM = 3; // C
const NOTE_COL_FROM = 5; // E
const SURVEY_DATE_CELL = { row: 2, col: 8 }; // H2（テンプレート側に日本語元号の日付書式が設定済み）
const SUBJECT_NAME_CELL = { row: 2, col: 12 }; // L2

type SectionLayout = { category: string; dataRowFrom: number; dataRowTo: number };

// 実ファイルの区分ごとの空欄行範囲（実ファイルを直接読み合わせて検証済み）
const SECTION_LAYOUT: SectionLayout[] = [
  { category: "1.移動や動作等", dataRowFrom: 5, dataRowTo: 10 },
  { category: "2.日常生活等", dataRowFrom: 12, dataRowTo: 19 },
  { category: "3.意思疎通等", dataRowFrom: 21, dataRowTo: 25 },
  { category: "4.行動障害等", dataRowFrom: 27, dataRowTo: 37 },
  { category: "5.特別な医療", dataRowFrom: 39, dataRowTo: 40 },
];

const isRequired = (status: string | undefined, baseline: string | undefined) =>
  !!status && status !== baseline;

// 複数項目をまとめた場合のIDラベルを作る。同じ群番号（例：1-4,1-5,1-6）なら
// まとめて1つの括弧にする。4群（行動障害）だけ実ファイルのプルダウン候補が
// 全角括弧・スペース無し表記のため、区分に応じて書式を切り替える。
function formatIdLabel(ids: string[], category: string): string {
  const isBehaviorGroup = category === "4.行動障害等";
  const open = isBehaviorGroup ? "（" : "( ";
  const close = isBehaviorGroup ? "）" : " )";
  const sep = isBehaviorGroup ? "" : " ";

  const parsed = ids.map(id => {
    const m = id.match(/^(\d+)-(\d+)$/);
    return m ? { group: m[1], num: m[2] } : null;
  });
  if (parsed.length > 0 && parsed.every(p => p !== null) && parsed.every(p => p!.group === parsed[0]!.group)) {
    const group = parsed[0]!.group;
    return `${open}${group}-${parsed.map(p => p!.num).join(",")}${close}`;
  }
  return ids.map(id => `${open}${id}${close}`).join(sep);
}

type NoteRow = { ids: string[]; label: string; text: string };

function buildRows(
  categoryItems: ExportItem[],
  category: string,
  selections: Record<string, string>,
  editedNotes: Record<string, string>,
  groups: ExportGroup[],
  baselineByItemId: Record<string, string>
): NoteRow[] {
  const groupByItemId = new Map<string, ExportGroup>();
  for (const g of groups) {
    for (const id of g.itemIds) groupByItemId.set(id, g);
  }

  const rows: NoteRow[] = [];
  const renderedGroups = new Set<ExportGroup>();

  for (const item of categoryItems) {
    const group = groupByItemId.get(item.id);
    if (group) {
      if (renderedGroups.has(group)) continue;
      renderedGroups.add(group);
      const text = (group.text || "").trim();
      if (!text) continue;
      rows.push({ ids: group.itemIds, label: formatIdLabel(group.itemIds, category), text });
      continue;
    }
    if (!isRequired(selections[item.id], baselineByItemId[item.id])) continue;
    const text = (editedNotes[item.id] || "").trim();
    if (!text) continue;
    rows.push({ ids: [item.id], label: formatIdLabel([item.id], category), text });
  }

  return rows;
}

function estimateRowHeightPt(text: string, fontSize: number, charsPerLineAtSize10 = 42): number {
  const charsPerLine = Math.max(10, Math.round((charsPerLineAtSize10 * 10) / fontSize));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  const lineHeightPt = fontSize * 1.3;
  return Math.max(15, lines * lineHeightPt + 3);
}

function writeDataRow(ws: ExcelJS.Worksheet, row: number, noteRow: NoteRow | undefined) {
  if (!noteRow) return; // 未使用行はテンプレートの空欄のまま
  const idCell = ws.getCell(row, ID_COL_FROM);
  idCell.value = noteRow.label;

  const noteCell = ws.getCell(row, NOTE_COL_FROM);
  noteCell.value = noteRow.text;
  noteCell.alignment = { ...(noteCell.alignment || {}), wrapText: true, vertical: "top" };

  const estimated = estimateRowHeightPt(noteRow.text, (noteCell.font && noteCell.font.size) || 10);
  if (!ws.getRow(row).height || ws.getRow(row).height! < estimated) {
    ws.getRow(row).height = estimated;
  }
}

export async function exportAssessmentToExcel(params: {
  items: ExportItem[];
  selections: Record<string, string>;
  editedNotes: Record<string, string>;
  groups: ExportGroup[];
  baselineByItemId: Record<string, string>;
  surveyDate?: string;
  subjectName?: string;
  fileName?: string;
}) {
  const { items, selections, editedNotes, groups, baselineByItemId, surveyDate, subjectName, fileName } = params;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`テンプレートの取得に失敗しました: ${TEMPLATE_URL}`);
  const originalBuffer = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(originalBuffer);
  const ws = wb.getWorksheet("特記事項");
  if (!ws) throw new Error("テンプレートに「特記事項」シートが見つかりません");

  if (surveyDate) {
    const d = new Date(`${surveyDate}T00:00:00+09:00`);
    if (!Number.isNaN(d.getTime())) {
      ws.getCell(SURVEY_DATE_CELL.row, SURVEY_DATE_CELL.col).value = d;
    }
  }
  if (subjectName) {
    ws.getCell(SUBJECT_NAME_CELL.row, SUBJECT_NAME_CELL.col).value = subjectName;
  }

  const overflow: string[] = [];

  for (const section of SECTION_LAYOUT) {
    const categoryItems = items.filter(i => i.category === section.category);
    const rows = buildRows(categoryItems, section.category, selections, editedNotes, groups, baselineByItemId);

    const capacity = section.dataRowTo - section.dataRowFrom + 1;
    if (rows.length > capacity) {
      overflow.push(`${section.category}（${rows.length}件 / 記入欄${capacity}行）`);
    }

    for (let i = 0; i < capacity; i++) {
      writeDataRow(ws, section.dataRowFrom + i, rows[i]);
    }
  }

  if (overflow.length > 0) {
    window.alert(
      `様式の記入欄より件数が多いため、一部の特記事項が出力されていません：${overflow.join("、")}`
    );
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `特記事項_記入済み_${Date.now()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

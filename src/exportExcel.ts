import ExcelJS from "exceljs";

// -------------------------------------------------------
// 認定調査票(特記事項) Excel出力
// 元の提出様式（xlsx）そのものが手元にないため、実際に様式を開いて
// 共有してもらった行番号・列構成（B列＝群の縦書きラベル、C:D列＝項目番号の
// プルダウン、E:M列＝特記文の結合セル、群ごとに固定行数の罫線）をもとに
// 再現したもの。フォント・列幅など細部は実際の様式と異なる可能性がある。
// -------------------------------------------------------

export type ExportItem = { id: string; category: string; name: string };
export type ExportGroup = { itemIds: string[]; text: string };

const ID_COL_FROM = 3; // C
const ID_COL_TO = 4; // D
const NOTE_COL_FROM = 5; // E
const NOTE_COL_TO = 13; // M
const LABEL_COL = 2; // B

type GroupLayout = { category: string; label: string; minRows: number };

// 群ごとの記入行数は、実際の記入件数に応じて自動的に増減する
// （件数が様式の目安行数を超えたら行を追加し、少なければ空欄行を削って詰める）。
// minRowsは、記入がゼロ件でも群の区切りが分かるよう最低限確保する行数。
// ラベルは番号と文言の間で改行させず、Excel側のvertical textの折り返しに任せる。
const GROUP_LAYOUT: GroupLayout[] = [
  { category: "1.移動や動作等", label: "1移動や動作等", minRows: 1 },
  { category: "2.日常生活等", label: "2身の回りの世話や日常生活等", minRows: 1 },
  { category: "3.意思疎通等", label: "3意思疎通等", minRows: 1 },
  { category: "4.行動障害等", label: "4行動障害", minRows: 1 },
  { category: "5.特別な医療", label: "5特別な医療", minRows: 1 },
];

const OTHER_GROUP = {
  label: "6その他",
  headerText: "認定調査の際に「調査対象者に必要とされる支援の度合い」に関することで確認できた事項",
  contentRows: 2,
};

const ERAS: { name: string; start: string }[] = [
  { name: "令和", start: "2019-05-01" },
  { name: "平成", start: "1989-01-08" },
  { name: "昭和", start: "1926-12-25" },
  { name: "大正", start: "1912-07-30" },
  { name: "明治", start: "1868-01-25" },
];

const WEEKDAY_KANJI = ["日", "月", "火", "水", "木", "金", "土"];

// <input type="date">のISO文字列（YYYY-MM-DD）を「令和7年9月17日(水)」の形式に変換する
function toWareki(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAY_KANJI[d.getDay()];

  for (const era of ERAS) {
    const eraStart = new Date(`${era.start}T00:00:00+09:00`);
    if (d.getTime() >= eraStart.getTime()) {
      const eraYear = y - eraStart.getFullYear() + 1;
      const yearLabel = eraYear === 1 ? "元" : String(eraYear);
      return `${era.name}${yearLabel}年${m}月${day}日(${weekday})`;
    }
  }
  return `${y}年${m}月${day}日(${weekday})`;
}

const isRequired = (status: string | undefined) =>
  !!status && !status.startsWith("1.") && status !== "生活に支障なし" && status !== "ない";

type NoteRow = { ids: string[]; label: string; text: string };

function buildRows(
  categoryItems: ExportItem[],
  selections: Record<string, string>,
  editedNotes: Record<string, string>,
  groups: ExportGroup[]
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
      rows.push({ ids: group.itemIds, label: group.itemIds.map(id => `(${id})`).join(""), text });
      continue;
    }
    if (!isRequired(selections[item.id])) continue;
    const text = (editedNotes[item.id] || "").trim();
    if (!text) continue;
    rows.push({ ids: [item.id], label: `(${item.id})`, text });
  }

  return rows;
}

function styleGroupLabel(ws: ExcelJS.Worksheet, fromRow: number, toRow: number, label: string) {
  ws.mergeCells(fromRow, LABEL_COL, toRow, LABEL_COL);
  const cell = ws.getCell(fromRow, LABEL_COL);
  cell.value = label;
  cell.font = { size: 10, bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle", textRotation: "vertical", wrapText: true };
}

// 矩形の外周だけに罫線を引く（内側の罫線は上書きしない）
function applyRectBorder(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  style: ExcelJS.BorderStyle
) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      const border = { ...cell.border };
      if (r === r1) border.top = { style };
      if (r === r2) border.bottom = { style };
      if (c === c1) border.left = { style };
      if (c === c2) border.right = { style };
      cell.border = border;
    }
  }
}

function applyRowSeparator(ws: ExcelJS.Worksheet, row: number) {
  for (let c = ID_COL_FROM; c <= NOTE_COL_TO; c++) {
    ws.getCell(row, c).border = { bottom: { style: "dotted" } };
  }
}

function writeHeaderRow(ws: ExcelJS.Worksheet, row: number, text: string) {
  ws.mergeCells(row, ID_COL_FROM, row, NOTE_COL_TO);
  const cell = ws.getCell(row, ID_COL_FROM);
  cell.value = text;
  cell.font = { size: 8 };
  cell.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 26;
  applyRowSeparator(ws, row);
}

function writeContentRow(
  ws: ExcelJS.Worksheet,
  row: number,
  noteRow: NoteRow | undefined,
  dropdownIds: string[]
) {
  ws.mergeCells(row, ID_COL_FROM, row, ID_COL_TO);
  const idCell = ws.getCell(row, ID_COL_FROM);
  idCell.value = noteRow ? noteRow.label : "";
  idCell.font = { size: 10 };
  idCell.alignment = { horizontal: "center", vertical: "top" };
  if (dropdownIds.length > 0) {
    idCell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${dropdownIds.map(id => `(${id})`).join(",")}"`],
    };
  }

  ws.mergeCells(row, NOTE_COL_FROM, row, NOTE_COL_TO);
  const noteCell = ws.getCell(row, NOTE_COL_FROM);
  noteCell.value = noteRow ? noteRow.text : "";
  noteCell.font = { size: 10 };
  noteCell.alignment = { wrapText: true, vertical: "top" };

  const estimatedLines = noteRow ? Math.max(1, Math.ceil(noteRow.text.length / 42)) : 1;
  ws.getRow(row).height = Math.max(18, estimatedLines * 15);

  applyRowSeparator(ws, row);
}

export async function exportAssessmentToExcel(params: {
  items: ExportItem[];
  selections: Record<string, string>;
  editedNotes: Record<string, string>;
  groups: ExportGroup[];
  surveyDate: string;
  subjectName: string;
  disabilityGrade?: string;
  fileName?: string;
}) {
  const { items, selections, editedNotes, groups, surveyDate, subjectName, disabilityGrade, fileName } = params;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("特記事項", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 3 }, // A: 余白
    { width: 4 }, // B: 群ラベル
    { width: 6 }, // C
    { width: 6 }, // D
    ...Array.from({ length: NOTE_COL_TO - NOTE_COL_FROM + 1 }, () => ({ width: 9 })), // E-M
  ];

  let r = 1; // 上部余白行
  r++; // r=2: タイトル・調査日・氏名

  ws.mergeCells(2, LABEL_COL, 2, NOTE_COL_TO);
  const metaParts = [`調査日：${toWareki(surveyDate)}`, `対象者氏名：${subjectName || ""}`];
  if (disabilityGrade) metaParts.push(`障害等級：${disabilityGrade}`);
  ws.getCell(2, LABEL_COL).value = {
    richText: [
      { font: { size: 12, bold: true }, text: "認定調査票(特記事項)　　" },
      { font: { size: 9 }, text: metaParts.join("　　") },
    ],
  };
  r = 4; // r=3: 空白の間隔行

  for (const g of GROUP_LAYOUT) {
    const categoryItems = items.filter(i => i.category === g.category);
    const rows = buildRows(categoryItems, selections, editedNotes, groups);
    const headerText =
      g.category === "4.行動障害等"
        ? "行動障害に関する項目　4-1から4-34"
        : categoryItems.map(i => i.name).join("　");

    const headerRow = r;
    writeHeaderRow(ws, headerRow, headerText);
    r++;

    const contentRows = Math.max(rows.length, g.minRows);
    for (let i = 0; i < contentRows; i++) {
      writeContentRow(ws, r, rows[i], categoryItems.map(it => it.id));
      r++;
    }

    styleGroupLabel(ws, headerRow, r - 1, g.label);
    applyRectBorder(ws, headerRow, LABEL_COL, r - 1, NOTE_COL_TO, "thin");
  }

  // 6.その他：現状アプリ側にこの内容を集める項目がないため、様式の見出しのみ用意し空欄にしておく
  const otherHeaderRow = r;
  writeHeaderRow(ws, otherHeaderRow, OTHER_GROUP.headerText);
  r++;
  for (let i = 0; i < OTHER_GROUP.contentRows; i++) {
    writeContentRow(ws, r, undefined, []);
    r++;
  }
  styleGroupLabel(ws, otherHeaderRow, r - 1, OTHER_GROUP.label);
  applyRectBorder(ws, otherHeaderRow, LABEL_COL, r - 1, NOTE_COL_TO, "thin");

  // 項目の表（1〜6群の一覧）の外枠だけを太罫線にする。タイトル行は含めない
  applyRectBorder(ws, 4, LABEL_COL, r - 1, NOTE_COL_TO, "thick");

  // B列（群ラベル）の右側に縦線を1本通す
  for (let row = 4; row <= r - 1; row++) {
    const cell = ws.getCell(row, LABEL_COL);
    cell.border = { ...cell.border, right: { style: "thin" } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `認定調査票_特記事項_${surveyDate || "未記入"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

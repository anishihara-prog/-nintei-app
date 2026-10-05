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

// 実ファイルの区分ごとの空欄行範囲（実ファイルを直接読み合わせて検証済み）。
// 特記事項は大半のケースがこの行数に収まるため、テンプレート自体は元のサイズの
// ままにしておき、収まらない場合だけ書き出し時にその区分の行を追加する
// （下のensureSectionCapacity参照）。
const SECTION_LAYOUT: SectionLayout[] = [
  { category: "1.移動や動作等", dataRowFrom: 5, dataRowTo: 10 },
  { category: "2.日常生活等", dataRowFrom: 12, dataRowTo: 19 },
  { category: "3.意思疎通等", dataRowFrom: 21, dataRowTo: 25 },
  { category: "4.行動障害等", dataRowFrom: 27, dataRowTo: 37 },
  { category: "5.特別な医療", dataRowFrom: 39, dataRowTo: 40 },
];

const isRequired = (status: string | undefined, baseline: string | undefined) =>
  !!status && status !== baseline;

// 項目IDを番号順（例：1-1, 1-2, ..., 1-10, 1-11）に並べるための比較関数。
// アプリのUI表示順は実際の調査票の出現順（区分をまたぐ非連番）に合わせているが、
// 特記事項.xlsxへの出力は区分内で項目番号の昇順に並んでいる方が確認しやすいため、
// 出力直前にこの順序へ並べ替える。
export function compareItemIdsNumerically(a: string, b: string): number {
  const pa = a.match(/^(\d+)-(\d+)$/);
  const pb = b.match(/^(\d+)-(\d+)$/);
  if (!pa || !pb) return a.localeCompare(b);
  const groupDiff = Number(pa[1]) - Number(pb[1]);
  if (groupDiff !== 0) return groupDiff;
  return Number(pa[2]) - Number(pb[2]);
}

// 複数項目をまとめた場合のIDラベルを作る。同じ群番号（例：1-4,1-5,1-6）なら
// まとめて1つの括弧にする。4群（行動障害）だけ実ファイルのプルダウン候補が
// 全角括弧・スペース無し表記のため、区分に応じて書式を切り替える。
export function formatIdLabel(unsortedIds: string[], category: string): string {
  const ids = [...unsortedIds].sort(compareItemIdsNumerically);
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

export type NoteRow = { ids: string[]; label: string; text: string };

export function buildRows(
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

// -------------------------------------------------------
// 区分の記入欄が足りない場合に、その場で行を追加する処理。
// 特記事項は大半のケースが元のテンプレートの行数に収まるため、テンプレート自体は
// 拡張せず、必要になったときだけ以下の関数で区分の末尾に行を追加する。
// 追加行には既存の最終行と同じ罫線・ID列プルダウンを設定し、区分ラベル（B列の
// 縦結合セル）も追加した行数分伸ばす。挿入位置より下にある結合セル・入力規則は
// すべて下にずらして整合性を保つ。
// -------------------------------------------------------

const SECTION_ROW_COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function captureRowStyle(ws: ExcelJS.Worksheet, row: number): Record<string, any> {
  const map: Record<string, any> = {};
  for (const col of SECTION_ROW_COLS) map[col] = cloneValue(ws.getCell(`${col}${row}`).style);
  return map;
}

function applyRowStyle(ws: ExcelJS.Worksheet, row: number, styleMap: Record<string, any>, height: number | undefined) {
  ws.getRow(row).height = height;
  for (const col of SECTION_ROW_COLS) ws.getCell(`${col}${row}`).style = cloneValue(styleMap[col]);
}

// 「最終行」の罫線パターン（上=点線／下=実線）から「中間行」用（上下とも点線）を作る
function deriveMiddleStyle(lastStyle: Record<string, any>): Record<string, any> {
  const middle: Record<string, any> = {};
  for (const col of SECTION_ROW_COLS) {
    const src = cloneValue(lastStyle[col]) || {};
    if (src.border && src.border.bottom) {
      src.border = { ...src.border, bottom: { style: "dotted", color: { indexed: 64 } } };
    }
    middle[col] = src;
  }
  return middle;
}

function parseAddr(addr: string): { col: string; row: number } {
  const m = addr.match(/^([A-Z]+)(\d+)$/)!;
  return { col: m[1], row: parseInt(m[2], 10) };
}

// spliceRowsは行の値・書式は正しくずらしてくれる（セルの結合関係も実体としては
// 正しくずれる）が、①データ検証（プルダウン等）は古いアドレスのまま残ってしまい、
// ②結合セルの衝突チェック用の内部レジストリは古い位置の情報が残ったままになり、
// 挿入位置以降で新たに結合セルを作ろうとすると誤って「既に結合済み」と判定されて
// しまう。そこでデータ検証は自前でアドレスをずらし、内部レジストリの古いエントリは
// （実際のセルの結合関係には影響しないため）挿入位置以降のものを削除して、以降の
// mergeCells呼び出しをブロックしないようにする。
function prepareForInsertion(ws: ExcelJS.Worksheet, atRow: number, count: number) {
  const dv = (ws as any).dataValidations.model as Record<string, any>;
  const newDv: Record<string, any> = {};
  for (const [addr, rule] of Object.entries(dv)) {
    const p = parseAddr(addr);
    newDv[p.row >= atRow ? `${p.col}${p.row + count}` : addr] = rule;
  }
  (ws as any).dataValidations.model = newDv;

  const merges = (ws as any)._merges as Record<string, any>;
  for (const masterAddr of Object.keys(merges)) {
    if (parseAddr(masterAddr).row >= atRow) delete merges[masterAddr];
  }
}

// 「特記事項」シートの5群直後（本来R38:R42）には、区分の項目とは無関係な別の
// ドロップダウン（C42/C45）用の値一覧が隠れている。5群の行を追加する際に挿入位置が
// この一覧の範囲を分断してしまうため、事前に安全な場所（シート末尾より後ろ）へ
// 値と参照式を移動しておく。upcomingNeedは、これから行う挿入（このシフトの後に
// 実際にspliceRowsされる行数）を見越して、移動先の参照式を事前に補正するために使う
// （値自体はspliceRowsによって正しく追従してずれるため、参照式だけ先読みで合わせる）。
function relocateStrayHelperListIfPresent(ws: ExcelJS.Worksheet, shiftSoFar: number, upcomingNeed: number) {
  const oldTop = 38 + shiftSoFar;
  const oldBottom = 42 + shiftSoFar;
  const oldRangeStr = `$R$${oldTop}:$R$${oldBottom}`;
  const dv = (ws as any).dataValidations.model as Record<string, any>;
  const affected = Object.entries(dv).filter(
    ([, rule]) => rule.type === "list" && rule.formulae && rule.formulae[0] === oldRangeStr
  );
  if (affected.length === 0) return;

  const vals: any[] = [];
  for (let r = oldTop; r <= oldBottom; r++) vals.push(ws.getCell(`R${r}`).value);
  for (let r = oldTop; r <= oldBottom; r++) ws.getCell(`R${r}`).value = null;

  const safeTop = ws.rowCount + 5;
  vals.forEach((v, i) => { ws.getCell(`R${safeTop + i}`).value = v; });
  // 値はこのすぐ後にspliceRowsされる際、upcomingNeed分だけさらに下にずれるため、
  // 参照式はその最終位置を先読みして設定する。
  const finalTop = safeTop + upcomingNeed;
  const newRangeStr = `$R$${finalTop}:$R$${finalTop + vals.length - 1}`;
  for (const [addr] of affected) {
    dv[addr] = { ...dv[addr], formulae: [newRangeStr] };
  }
}

function ensureSectionCapacity(
  ws: ExcelJS.Worksheet,
  headingRow: number,
  currentLastRow: number,
  need: number
): number {
  const lastStyle = captureRowStyle(ws, currentLastRow);
  const middleStyle = deriveMiddleStyle(lastStyle);
  const height = ws.getRow(currentLastRow).height;
  const idValidation = (ws as any).dataValidations.model[`C${currentLastRow}`];

  const atRow = currentLastRow + 1;
  // spliceRowsは挿入位置より下の結合セル（次の区分の見出し・記入欄など）を失うため、
  // 事前に控えておき、挿入後にずらした位置へ結合し直す。
  const mergesBelow: string[] = ((ws.model as any).merges as string[]).filter(
    m => parseAddr(m.split(":")[0]).row >= atRow
  );
  const blanks: any[][] = Array.from({ length: need }, () => []);
  ws.spliceRows(atRow, 0, ...blanks);
  prepareForInsertion(ws, atRow, need);
  for (const range of mergesBelow) {
    const [from, to] = range.split(":");
    const a = parseAddr(from);
    const b = parseAddr(to);
    try {
      ws.mergeCells(`${a.col}${a.row + need}:${b.col}${b.row + need}`);
    } catch {
      // すでに結合済みの場合は何もしない
    }
  }
  const printArea = ws.pageSetup.printArea;
  const pa = printArea && printArea.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (pa && parseInt(pa[4], 10) >= atRow) {
    ws.pageSetup.printArea = `${pa[1]}${pa[2]}:${pa[3]}${parseInt(pa[4], 10) + need}`;
  }

  applyRowStyle(ws, currentLastRow, middleStyle, height); // 元の最終行は「中間行」の見た目に変える

  const newLastRow = atRow + need - 1;
  for (let r = atRow; r <= newLastRow; r++) {
    applyRowStyle(ws, r, r === newLastRow ? lastStyle : middleStyle, height);
    ws.mergeCells(`C${r}:D${r}`);
    ws.mergeCells(`E${r}:M${r}`);
    if (idValidation) {
      (ws as any).dataValidations.model[`C${r}`] = cloneValue(idValidation);
      (ws as any).dataValidations.model[`D${r}`] = cloneValue(idValidation);
    }
  }

  ws.unMergeCells(`B${headingRow}:B${currentLastRow}`);
  ws.mergeCells(`B${headingRow}:B${newLastRow}`);

  return newLastRow;
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

  // 区分ごとに必要な行数を集計し、テンプレートの記入欄より多い場合はその場で行を追加する。
  let cumulativeShift = 0;
  for (const section of SECTION_LAYOUT) {
    const categoryItems = items
      .filter(i => i.category === section.category)
      .sort((a, b) => compareItemIdsNumerically(a.id, b.id));
    const rows = buildRows(categoryItems, section.category, selections, editedNotes, groups, baselineByItemId);

    const currentFrom = section.dataRowFrom + cumulativeShift;
    let currentTo = section.dataRowTo + cumulativeShift;
    let capacity = currentTo - currentFrom + 1;

    if (rows.length > capacity) {
      const need = rows.length - capacity;
      if (section.category === "5.特別な医療") {
        relocateStrayHelperListIfPresent(ws, cumulativeShift, need);
      }
      currentTo = ensureSectionCapacity(ws, currentFrom - 1, currentTo, need);
      cumulativeShift += need;
      capacity = currentTo - currentFrom + 1;
    }

    for (let i = 0; i < capacity; i++) {
      writeDataRow(ws, currentFrom + i, rows[i]);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || (subjectName ? `${subjectName}　特記事項.xlsx` : `特記事項_記入済み_${Date.now()}.xlsx`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

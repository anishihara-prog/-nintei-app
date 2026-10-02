import JSZip from "jszip";

// ExcelJSで.xlsmを読み込んで書き出すと、以下の3つが失われる：
// ①xl/vbaProject.binとそれを参照する[Content_Types].xml・
//   xl/_rels/workbook.xml.relsのエントリ（マクロ無しの.xlsxと同等の中身になる）
// ②図形（オートシェイプ。例：四角形）の定義。埋め込み画像は保持されるが、
//   その上に重ねて表示・非表示を切り替えるための四角形の枠だけが消えてしまう
//   （「認定調査票.xlsm」の調査票提出用シートは、この枠をマクロが
//   表示/非表示切り替えすることで判定結果を示す作りになっている）。
// ③各シートのcodeName（<sheetPr codeName="Sheet2"/>等）。VBAコード内で
//   「Sheet2.Range(...)」のようにシートをcodeNameで参照している箇所は、この属性が
//   無いとExcel側でオブジェクトを解決できず、実行時エラー429
//   「ActiveXコンポーネントはオブジェクトを作成できません」になる。
//   さらにExcelJSは書き出し時にシートのファイル名も振り直す（例：sheet2.xml→
//   sheet24.xml）ため、ファイル名ではなくシート名（workbook.xmlのname属性）を
//   手がかりに元ファイルと対応付けてcodeNameを復元する。
// 元ファイルのvbaProject.bin・関連エントリ・図形定義・各シートのcodeNameを
// 書き出し後のzipに再注入し、マクロが正しく動く状態に復元する。

function getAttr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

// workbook.xmlの<sheet>要素一覧から、シート名→(r:id経由で辿れる)ワークシートXMLの
// 中身、を取得するためのヘルパー。
async function getSheetXmlByName(zip: JSZip): Promise<Map<string, { path: string; xml: string }>> {
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");

  const relTargetById = new Map<string, string>();
  for (const tag of relsXml.match(/<Relationship\b[^>]*\/>/g) || []) {
    const id = getAttr(tag, "Id");
    const target = getAttr(tag, "Target");
    if (id && target) relTargetById.set(id, target);
  }

  const result = new Map<string, { path: string; xml: string }>();
  for (const tag of workbookXml.match(/<sheet\b[^>]*\/>/g) || []) {
    const name = getAttr(tag, "name");
    const rId = getAttr(tag, "r:id");
    if (!name || !rId) continue;
    const target = relTargetById.get(rId);
    if (!target) continue;
    const path = `xl/${target.replace(/^\/?/, "")}`;
    const file = zip.file(path);
    if (!file) continue;
    result.set(name, { path, xml: await file.async("string") });
  }
  return result;
}
export async function repairXlsmMacro(
  filledBuffer: ArrayBuffer | Uint8Array,
  originalBuffer: ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  const [newZip, origZip] = await Promise.all([
    JSZip.loadAsync(filledBuffer),
    JSZip.loadAsync(originalBuffer),
  ]);

  const vbaProjectFile = origZip.file("xl/vbaProject.bin");
  if (!vbaProjectFile) {
    // マクロを含まないテンプレートの場合は何もせず返す
    return newZip.generateAsync({ type: "uint8array" });
  }
  const vbaBin = await vbaProjectFile.async("uint8array");
  newZip.file("xl/vbaProject.bin", vbaBin);

  const contentTypesFile = newZip.file("[Content_Types].xml");
  if (!contentTypesFile) throw new Error("[Content_Types].xml が見つかりません");
  let contentTypes = await contentTypesFile.async("string");
  contentTypes = contentTypes.replace(
    'PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"',
    'PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"'
  );
  if (!contentTypes.includes("/xl/vbaProject.bin")) {
    contentTypes = contentTypes.replace(
      "</Types>",
      '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'
    );
  }
  newZip.file("[Content_Types].xml", contentTypes);

  const relsFile = newZip.file("xl/_rels/workbook.xml.rels");
  if (!relsFile) throw new Error("xl/_rels/workbook.xml.rels が見つかりません");
  let rels = await relsFile.async("string");
  if (!rels.includes("vbaProject.bin")) {
    const existingIds = [...rels.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
    const nextId = Math.max(0, ...existingIds) + 1;
    rels = rels.replace(
      "</Relationships>",
      `<Relationship Id="rId${nextId}" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>`
    );
  }
  newZip.file("xl/_rels/workbook.xml.rels", rels);

  // 図形定義（xl/drawings/drawingN.xml）を元ファイルの内容でそのまま置き換える。
  // 対応するrels・画像ファイルの参照先（rId・ファイル名）は書き出し前後で
  // 変わらないため、xmlファイルの中身だけ差し替えれば整合性が保たれる。
  const origDrawingFiles = origZip.file(/^xl\/drawings\/drawing\d+\.xml$/);
  for (const file of origDrawingFiles) {
    if (!newZip.file(file.name)) continue;
    const content = await file.async("uint8array");
    newZip.file(file.name, content);
  }

  // 各シートのcodeNameを、シート名を手がかりに元ファイルから復元する。
  const origSheetsByName = await getSheetXmlByName(origZip);
  const newSheetsByName = await getSheetXmlByName(newZip);
  for (const [name, { path, xml }] of newSheetsByName) {
    const codeName = origSheetsByName.get(name)?.xml.match(/<sheetPr\b[^>]*\bcodeName="([^"]*)"/)?.[1];
    if (!codeName || /codeName="/.test(xml)) continue;
    const patched = /<sheetPr\b/.test(xml)
      ? xml.replace(/<sheetPr\b/, `<sheetPr codeName="${codeName}"`)
      : xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr codeName="${codeName}"/>`);
    newZip.file(path, patched);
  }

  return newZip.generateAsync({ type: "uint8array" });
}

import JSZip from "jszip";

// ExcelJSで.xlsmを読み込んで書き出すと、xl/vbaProject.binとそれを参照する
// [Content_Types].xml・xl/_rels/workbook.xml.relsのエントリが失われ、
// マクロ無しの.xlsxと同等の中身になってしまう。
// 元ファイルのvbaProject.binと関連エントリを書き出し後のzipに再注入し、
// マクロ有効ブックとして開けるように復元する。
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

  return newZip.generateAsync({ type: "uint8array" });
}

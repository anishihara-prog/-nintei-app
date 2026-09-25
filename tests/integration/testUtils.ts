// exportExcel.ts / exportSurveySheet.ts はブラウザ専用API（fetch, document, URL.createObjectURL）
// を直接使う実装のため、jsdom環境でこれらを最小限モックし、実際に生成されたExcelブックの
// バイト列を取り出せるようにするテスト用ヘルパー。
import { readFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import { vi } from "vitest";

const PROJECT_ROOT = join(__dirname, "../..");

export function mockBrowserExportEnvironment() {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  // jsdomはダウンロード用のダミーリンククリックを「別ドキュメントへの遷移」として
  // 警告を出すため、実際のダウンロード処理には不要なnavigationを無効化する。
  HTMLAnchorElement.prototype.click = vi.fn();

  let capturedBlob: Blob | null = null;

  global.fetch = vi.fn(async (url: string | URL) => {
    const pathname = typeof url === "string" ? url : url.toString();
    const filePath = join(PROJECT_ROOT, "public", pathname);
    const buf = readFileSync(filePath);
    return {
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as Response;
  }) as unknown as typeof fetch;

  URL.createObjectURL = vi.fn((blob: Blob) => {
    capturedBlob = blob;
    return "blob:mock-url";
  });
  URL.revokeObjectURL = vi.fn();

  return {
    getCapturedWorkbook: async (): Promise<ExcelJS.Workbook> => {
      if (!capturedBlob) throw new Error("Blobがまだ生成されていません（エクスポート関数を先に呼んでください）");
      const arrayBuffer = await capturedBlob.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(arrayBuffer);
      return wb;
    },
    restore: () => {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    },
  };
}

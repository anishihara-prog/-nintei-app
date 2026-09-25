import type { Page, Download } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// アプリはlocalStorageに選択状態を保存する（キーはsrc/App.tsxのSTORAGE_KEYS参照）。
// UIを1つずつクリックする代わりに、状態を直接注入してリロードすることで、
// テストを高速・安定させる（実際のレンダリング・エクスポート処理は変えず経由させる）。
export async function setAppState(
  page: Page,
  state: {
    selections?: Record<string, string>;
    notes?: Record<string, string>;
    groups?: { id: string; itemIds: string[]; text: string }[];
    subjectName?: string;
    surveyDate?: string;
    disabilityGrade?: string;
  }
) {
  await page.evaluate((s) => {
    if (s.selections) {
      const base = JSON.parse(localStorage.getItem("manual_selections") || "{}");
      localStorage.setItem("manual_selections", JSON.stringify({ ...base, ...s.selections }));
    }
    if (s.notes) localStorage.setItem("manual_notes", JSON.stringify(s.notes));
    if (s.groups) localStorage.setItem("manual_groups", JSON.stringify(s.groups));
    if (s.subjectName !== undefined) localStorage.setItem("manual_subject_name", JSON.stringify(s.subjectName));
    if (s.surveyDate !== undefined) localStorage.setItem("manual_survey_date", JSON.stringify(s.surveyDate));
    if (s.disabilityGrade !== undefined) localStorage.setItem("manual_disability_grade", JSON.stringify(s.disabilityGrade));
  }, state);
  await page.reload({ waitUntil: "networkidle" });
}

export async function clearAppState(page: Page) {
  await page.evaluate(() => {
    Object.keys(localStorage).forEach((k) => localStorage.removeItem(k));
  });
}

export async function downloadWorkbook(download: Download): Promise<ExcelJS.Workbook> {
  const dir = mkdtempSync(join(tmpdir(), "nintei-e2e-"));
  const path = join(dir, download.suggestedFilename());
  await download.saveAs(path);
  const buffer = readFileSync(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

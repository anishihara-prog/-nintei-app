/**
 * CLI用: 認定調査AI判定エンジン
 * Gemini APIを使用して80項目を自動判定
 * プロンプト・判定ロジックは server/index.js（Web UI版）と同じものを流用している。
 */

import {
  CLI_ASSESSMENT_ITEMS,
  OPTION_CRITERIA,
  INITIAL_SELECTIONS,
  type CliAssessmentItem,
} from "./assessmentItems.js";
import { createGeminiClient, getGeminiModel, COMMON_JUDGMENT_NOTES } from "./engine/shared.js";

export type AssessmentItem = CliAssessmentItem;

export type Confidence = "explicit" | "inferred" | "unmentioned" | null;
export type JudgeSource = "ai" | "default" | "invalid";

export interface JudgeResult {
  itemId: string;
  selectedOption: string;
  confidence: Confidence;
  source: JudgeSource;
  reasoning: string;
}

export interface JudgeResponse {
  results: JudgeResult[];
  missingItemIds: string[];
}

function buildJudgePrompt(intakeText: string, items: CliAssessmentItem[]): string {
  const itemLines = items
    .map((it) => {
      const criteria = OPTION_CRITERIA[it.id] || {};
      const criteriaLines = Object.entries(criteria)
        .map(([opt, text]) => `    - "${opt}": ${(text || "").replace(/\n/g, " ")}`)
        .join("\n");
      return (
        `- id:"${it.id}" 群:"${it.category}" 項目名:"${it.name}"\n` +
        `  評価内容: ${it.description || ""} ${it.kitaGuide || ""}\n` +
        `  選択肢と判断基準:\n${criteriaLines}`
      );
    })
    .join("\n");

  return `あなたは障害支援区分の認定調査員を支援する専門家です。
以下の「聞き取った状況」の自由記述文を読み、80項目それぞれについて、選択肢のうちどれに該当するかを判定してください。
文章の作成（特記事項の執筆）は行わないでください。判定（選択肢の選択）のみを行ってください。

${COMMON_JUDGMENT_NOTES}

--- 聞き取った状況 ---
${intakeText}
--- ここまで ---

--- 調査項目一覧（全${items.length}項目） ---
${itemLines}
--- ここまで ---

各項目について、次のルールで判定してください。
- 聞き取った状況の本文に明記されている場合は、該当する選択肢を選び、confidenceは"explicit"、evidenceには根拠となった本文の一部（30字程度）を引用する。
- 本文に直接の記載はないが、他の記述から合理的に推測できる場合は、confidenceを"inferred"とし、evidenceに推測の根拠を書く。
- 本文に手がかりが全くない場合は、選択肢は「最も支援の必要性が低い選択肢（1.支援不要、生活に支障なし、ない等）」を選び、confidenceは"unmentioned"とし、evidenceは空文字列にする。根拠のない重い判定を作り出さないこと。
- optionには、その項目のoptions配列に含まれる文字列を一字一句そのまま使うこと（意訳・省略・改変は不可）。

出力は次のJSON形式の配列のみとしてください。前後に説明文やコードブロック記号（\`\`\`）は付けないでください。全${items.length}項目分、必ずすべてのidについて1件ずつ出力してください（省略しないこと）。

[
  {
    "itemId": "項目のid（一覧に存在するものを厳密に一致させる）",
    "option": "選択した選択肢の文字列（optionsに含まれるものと完全一致）",
    "confidence": "explicit" または "inferred" または "unmentioned",
    "evidence": "判定根拠（30字程度、日本語）"
  }
]`;
}

interface RawJudgeEntry {
  itemId?: unknown;
  option?: unknown;
  confidence?: unknown;
  evidence?: unknown;
}

/**
 * Gemini APIを使用して聞き取り内容から認定調査項目を判定
 * 本文に根拠のない項目はAIの提案を採用せず、安全側のデフォルト値で上書きする
 * （server/index.js の /api/judge と同じ安全策）。
 */
export async function runAssessmentJudge(
  intakeText: string,
  items: AssessmentItem[] = CLI_ASSESSMENT_ITEMS
): Promise<JudgeResponse> {
  const client = createGeminiClient();
  const model = getGeminiModel();
  const prompt = buildJudgePrompt(intakeText, items);

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = response.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini応答のJSON解析に失敗しました: ${raw.slice(0, 500)}`);
  }

  const itemById = new Map(items.map((it) => [it.id, it]));
  const seen = new Set<string>();
  const results: JudgeResult[] = [];

  for (const entry of Array.isArray(parsed) ? (parsed as RawJudgeEntry[]) : []) {
    if (!entry || typeof entry.itemId !== "string") continue;
    const item = itemById.get(entry.itemId);
    if (!item) continue;

    const optionValid = typeof entry.option === "string" && item.options.includes(entry.option);
    const confidenceValid = ["explicit", "inferred", "unmentioned"].includes(
      entry.confidence as string
    );
    const defaultOption = INITIAL_SELECTIONS[item.id] || item.options[0];

    if (optionValid && confidenceValid && entry.confidence === "unmentioned") {
      // 本文に根拠がないとAI自身が申告した項目は、AIの提案を採用せずデフォルト値で上書きする。
      results.push({
        itemId: entry.itemId,
        selectedOption: defaultOption,
        confidence: "unmentioned",
        source: "default",
        reasoning: "",
      });
    } else if (optionValid && confidenceValid) {
      results.push({
        itemId: entry.itemId,
        selectedOption: entry.option as string,
        confidence: entry.confidence as Confidence,
        source: "ai",
        reasoning: typeof entry.evidence === "string" ? entry.evidence : "",
      });
    } else {
      results.push({
        itemId: entry.itemId,
        selectedOption: defaultOption,
        confidence: null,
        source: "invalid",
        reasoning: "",
      });
    }
    seen.add(entry.itemId);
  }

  // 応答に含まれなかった項目はデフォルト値で埋め、必ず全件を1:1で返す。
  const missingItemIds: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const defaultOption = INITIAL_SELECTIONS[item.id] || item.options[0];
    results.push({
      itemId: item.id,
      selectedOption: defaultOption,
      confidence: null,
      source: "invalid",
      reasoning: "",
    });
    missingItemIds.push(item.id);
  }

  return { results, missingItemIds };
}

/**
 * 判定結果を読みやすい形式で表示
 */
export function formatJudgeResults(response: JudgeResponse): string {
  let output = "\n【AI判定結果】\n";
  output += "=".repeat(50) + "\n";

  output += "\n【項目ごとの判定】\n";
  response.results.forEach((result) => {
    output += `\n${result.itemId}:\n`;
    output += `  判定: ${result.selectedOption}\n`;
    output += `  根拠区分: ${result.confidence ?? "不明"} (${result.source})\n`;
    if (result.reasoning) {
      output += `  理由: ${result.reasoning}\n`;
    }
  });

  if (response.missingItemIds.length > 0) {
    output += `\n【警告】\n`;
    output += `⚠️  AI応答に含まれず、デフォルト値で補完した項目: ${response.missingItemIds.join(", ")}\n`;
  }

  output += "\n" + "=".repeat(50) + "\n";
  return output;
}

export const ASSESSMENT_ITEMS = CLI_ASSESSMENT_ITEMS;

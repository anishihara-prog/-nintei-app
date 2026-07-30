/**
 * CLI用: 特記事項アドバイザー
 * 相談員が書いた特記事項の文章が、選択した判定水準と食い違っていないかをAIが助言する。
 * 文章の書き換えは行わない。プロンプト・検証ロジックは server/index.js の /api/review と同じもの
 * （フィールド名の不一致バグを修正した上で）を移植している。
 */

import { CLI_ASSESSMENT_ITEMS, OPTION_CRITERIA, type CliAssessmentItem } from "../assessmentItems.js";
import { COMMON_JUDGMENT_NOTES, callGeminiJSON } from "./shared.js";
import type { AssessmentSession, ReviewComment } from "../sessionManager.js";

export interface ReviewTarget {
  itemId: string;
  name: string;
  category: string;
  option: string;
  criteria: string;
  allOptions: string[];
  allCriteria: Record<string, string>;
  text: string;
}

function formatOtherCriteria(
  allOptions: string[],
  allCriteria: Record<string, string>,
  selectedOption: string
): string {
  if (!Array.isArray(allOptions) || !allCriteria) return "";
  return allOptions
    .filter((opt) => opt !== selectedOption)
    .map((opt) => `"${opt}"(基準:"${(allCriteria[opt] || "なし").replace(/\n/g, " ")}")`)
    .join(" / ");
}

/**
 * セッションの judgements/specialNotes から、テキストが入力済みの項目だけをレビュー対象として抽出する。
 * src/App.tsx の individualTargets 抽出ロジック（text.trim().length > 0 でフィルタ）と同じ。
 */
export function buildReviewTargetsFromSession(
  session: AssessmentSession,
  items: CliAssessmentItem[] = CLI_ASSESSMENT_ITEMS
): ReviewTarget[] {
  const targets: ReviewTarget[] = [];
  for (const it of items) {
    const option = session.judgements[it.id];
    const text = session.specialNotes[it.id] || "";
    if (!option || !text.trim()) continue;
    targets.push({
      itemId: it.id,
      name: it.name,
      category: it.category,
      option,
      criteria: OPTION_CRITERIA[it.id]?.[option] || "",
      allOptions: it.options,
      allCriteria: OPTION_CRITERIA[it.id] || {},
      text,
    });
  }
  return targets;
}

export function buildReviewPrompt(referenceInfo: string, items: ReviewTarget[]): string {
  const itemLines = items
    .map((it) => {
      const base =
        `- id:"${it.itemId}" 群:"${it.category}" 項目名:"${it.name}" 選択された判定:"${it.option}" ` +
        `判定基準:"${(it.criteria || "").replace(/\n/g, " ")}" 相談員が書いた特記文:"${it.text}"`;
      const other = formatOtherCriteria(it.allOptions, it.allCriteria, it.option);
      return other ? `${base}\n  ・他の選択肢: ${other}` : base;
    })
    .join("\n");

  return `あなたは障害支援区分の認定調査における特記事項を、市町村審査会に提出する前にチェックする専門家です。
相談員が書いた特記事項が審査会で差し戻されないよう、助言（指摘）のみを行ってください。文章の書き換えは行わないでください。

対象者の障害等級（参考情報。空欄の場合もあります）：
${referenceInfo || "（未入力）"}

以下は基本調査の各項目について、選択された判定・判定基準・相談員が記入した特記事項の一覧です。

--- 項目一覧 ---
${itemLines}
--- ここまで ---

${COMMON_JUDGMENT_NOTES}

各項目について、次の観点でチェックしてください。
- 選択された判定の水準に見合う、具体的な「身体的理由」「生活上の支障」「介護の内容」が書かれているか（抽象的・紋切り型の記述は審査会で差し戻されやすい）
- 判定基準の内容と矛盾していないか
- 特記文に書かれている介護の内容・程度が、選択した判定の水準と食い違っていないか（例：「見守り等」を選択しているのに、実際には身体に触れる部分的な介助が必要と読める内容が書かれている、逆に「部分支援」を選択しているのに見守り程度の内容しか書かれていない、など）。食い違いがあれば、どちらの水準の内容に読めるかを具体的に指摘する
- 障害等級が入力されている場合、その等級から見て記述内容に無理がないか
- 頻度・程度など具体性を欠く曖昧な表現になっていないか
- 「〜が難しい」「〜が困難」のような曖昧な言い回しで済ませず、具体的に何ができないか（できないことそのもの）が書かれているか
- 一覧に「他の選択肢」の判定基準を併記している項目では、それらと比較して、なぜ他の水準（1段階上・下など）ではなく選択した水準になるのかが特記文から読み取れるか（水準間の違いが不明確な記述は指摘する）
- 上記の「共通の判断基準」に該当する状況（支援拒否、福祉用具の使用状況、一時的な事情による行為の中断、施設入所中の想定環境など）がある場合、その考え方に沿った記載になっているか

問題がなければ無理に指摘を作らず、needsAttentionはfalseにして短い確認コメントを返してください。
出力は次のJSON形式の配列のみとしてください。前後に説明文やコードブロック記号（\`\`\`）は付けないでください。

[
  {
    "itemId": "項目のid（一覧に存在するものを厳密に一致させる）",
    "needsAttention": true または false,
    "comment": "40字程度の日本語の一言コメント"
  }
]`;
}

interface RawReviewEntry {
  itemId?: unknown;
  needsAttention?: unknown;
  comment?: unknown;
}

/**
 * session.clientInfo.notes を、Web版の disabilityGrade に相当する参考情報として代用する。
 * CLIの AssessmentSession には障害等級の専用フィールドがないための代替。
 */
export async function runSpecialNotesReview(
  session: AssessmentSession,
  items: CliAssessmentItem[] = CLI_ASSESSMENT_ITEMS,
  referenceInfo: string = session.clientInfo.notes || ""
): Promise<Record<string, ReviewComment>> {
  const targets = buildReviewTargetsFromSession(session, items);
  if (targets.length === 0) return {};

  const prompt = buildReviewPrompt(referenceInfo, targets);
  // server/index.js の /api/review と同じ設定（maxOutputTokens/thinkingConfigは付けない）
  const parsed = await callGeminiJSON(prompt);

  const validIds = new Set(targets.map((t) => t.itemId));
  const result: Record<string, ReviewComment> = {};
  for (const entry of Array.isArray(parsed) ? (parsed as RawReviewEntry[]) : []) {
    if (!entry || typeof entry.itemId !== "string" || !validIds.has(entry.itemId)) continue;
    result[entry.itemId] = {
      needsAttention: !!entry.needsAttention,
      comment: typeof entry.comment === "string" ? entry.comment : "",
    };
  }
  return result;
}

export function formatReviewComments(comments: Record<string, ReviewComment>): string {
  const entries = Object.entries(comments);
  if (entries.length === 0) {
    return "\n（チェック対象の特記事項がありませんでした）\n";
  }
  let output = "\n【AIによる特記事項チェック結果】\n";
  output += "=".repeat(50) + "\n";
  for (const [itemId, c] of entries) {
    const mark = c.needsAttention ? "⚠️ " : "✅ ";
    output += `${mark}${itemId}: ${c.comment}\n`;
  }
  output += "=".repeat(50) + "\n";
  return output;
}

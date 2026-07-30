/**
 * CLI用: AI確認チャット（聞き取り内容の情報不足を埋めるための質問応答フロー）
 * 既存のコードベースに前例のない新規機能。
 *
 * 流れ:
 *   1. 初回のAI判定（runAssessmentJudge）を実行
 *   2. confidenceが inferred / unmentioned / null（無効・未応答） の項目を「情報不足」とみなす
 *   3. 情報不足項目だけを対象に、AIへ確認質問を生成させる
 *   4. 相談員が readline 経由で回答し、Q&Aを聞き取りテキストに追記
 *   5. 追記後のテキストで再度AI判定を行う
 *   6. 情報不足が無くなる／AIが質問なし／相談員が終了操作／ラウンド上限、のいずれかで終了
 *
 * 対話が途中で終わっても、runAssessmentJudge内の「unmentioned→安全側デフォルトに強制上書き」
 * ガードは常に効いたままなので、根拠のない判定が生まれることはない。
 */

import type { CliAssessmentItem } from "../assessmentItems.js";
import { CLI_ASSESSMENT_ITEMS } from "../assessmentItems.js";
import { runAssessmentJudge, type JudgeResponse } from "../assessmentEngine.js";
import { callGeminiJSON } from "./shared.js";
import type { ConversationTurn } from "../sessionManager.js";

export interface GapItem {
  itemId: string;
  name: string;
  category: string;
}

export interface FollowUpQuestion {
  question: string;
  relatedItemIds: string[];
}

const STOP_WORDS = /^(終了|skip|done)$/i;

/**
 * confidenceが explicit ではない（inferred / unmentioned / 無効で埋められた null）項目を抽出する。
 */
export function identifyGapItems(
  judge: JudgeResponse,
  items: CliAssessmentItem[] = CLI_ASSESSMENT_ITEMS
): GapItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const gaps: GapItem[] = [];
  for (const r of judge.results) {
    if (r.confidence === "explicit") continue;
    const item = byId.get(r.itemId);
    if (!item) continue;
    gaps.push({ itemId: item.id, name: item.name, category: item.category });
  }
  return gaps;
}

export function composeIntakeWithTranscript(
  intakeText: string,
  transcript: ConversationTurn[]
): string {
  if (transcript.length === 0) return intakeText;
  const qa = transcript
    .map((t) => (t.role === "assistant" ? `Q: ${t.text}` : `A: ${t.text}`))
    .join("\n");
  return `${intakeText}\n\n--- 追加の聞き取り（AIによる確認質問と回答） ---\n${qa}\n--- ここまで ---`;
}

function buildFollowUpQuestionsPrompt(
  intakeText: string,
  transcript: ConversationTurn[],
  gaps: GapItem[],
  items: CliAssessmentItem[],
  maxQuestions: number
): string {
  const byId = new Map(items.map((it) => [it.id, it]));
  const gapLines = gaps
    .map((g) => {
      const item = byId.get(g.itemId);
      const kitaGuide = item?.kitaGuide ? ` 評価の着眼点: ${item.kitaGuide}` : "";
      return `- id:"${g.itemId}" 群:"${g.category}" 項目名:"${g.name}"${kitaGuide}`;
    })
    .join("\n");

  const context = composeIntakeWithTranscript(intakeText, transcript);

  return `あなたは障害支援区分の認定調査を支援する専門家です。
以下の「これまでの聞き取り内容」を読み、下記の「情報が不足している項目」について、相談員が対象者・家族に確認すれば埋まりそうな質問を作成してください。

--- これまでの聞き取り内容 ---
${context}
--- ここまで ---

--- 情報が不足している項目（本文に記載がないか、推測にとどまる項目） ---
${gapLines}
--- ここまで ---

質問作成のルール:
- 質問は最大${maxQuestions}件まで。相談員が1〜2文で答えられる、具体的で自然な日本語の質問にすること。
- 関連する項目が複数ある場合は、1つの質問にまとめてよい（例:「歩行や立ち上がりに介助は必要ですか？」で複数の移動関連項目をまとめて確認する等）。
- 一覧にない項目について質問を作らないこと。
- 既にこれまでの聞き取り内容から十分に判断できる、もう確認する必要がないと判断した場合は、無理に質問を作らず空配列を返してよい。

出力は次のJSON形式の配列のみとしてください。前後に説明文やコードブロック記号（\`\`\`）は付けないでください。

[
  {
    "question": "質問文（日本語）",
    "relatedItemIds": ["関連する項目のid（一覧に存在するものを厳密に一致させる）"]
  }
]`;
}

interface RawQuestionEntry {
  question?: unknown;
  relatedItemIds?: unknown;
}

export async function generateFollowUpQuestions(
  intakeText: string,
  transcript: ConversationTurn[],
  gaps: GapItem[],
  items: CliAssessmentItem[] = CLI_ASSESSMENT_ITEMS,
  maxQuestions = 5
): Promise<FollowUpQuestion[]> {
  if (gaps.length === 0) return [];

  const prompt = buildFollowUpQuestionsPrompt(intakeText, transcript, gaps, items, maxQuestions);
  const parsed = await callGeminiJSON(prompt, { maxOutputTokens: 2048, thinkingBudget: 0 });

  const gapIds = new Set(gaps.map((g) => g.itemId));
  const questions: FollowUpQuestion[] = [];
  for (const entry of Array.isArray(parsed) ? (parsed as RawQuestionEntry[]) : []) {
    if (!entry || typeof entry.question !== "string" || !entry.question.trim()) continue;
    const relatedItemIds = Array.isArray(entry.relatedItemIds)
      ? entry.relatedItemIds.filter((id): id is string => typeof id === "string" && gapIds.has(id))
      : [];
    questions.push({ question: entry.question.trim(), relatedItemIds });
    if (questions.length >= maxQuestions) break;
  }
  return questions;
}

export interface GapFillingOptions {
  maxRounds?: number;
  maxQuestionsPerRound?: number;
}

export interface GapFillingResult {
  transcript: ConversationTurn[];
  finalJudge: JudgeResponse;
}

/**
 * ask: CLIのreadlineベースの質問関数（cli/index.tsのquestionヘルパーをそのまま渡せる）。
 * 相談員が空Enter、または「終了」「skip」「done」を入力すると、その回の残り質問をスキップして打ち切る。
 */
export async function runGapFillingChat(
  intakeText: string,
  items: CliAssessmentItem[] = CLI_ASSESSMENT_ITEMS,
  ask: (question: string) => Promise<string>,
  opts: GapFillingOptions = {}
): Promise<GapFillingResult> {
  const maxRounds = opts.maxRounds ?? 3;
  const maxQuestionsPerRound = opts.maxQuestionsPerRound ?? 5;

  const transcript: ConversationTurn[] = [];
  let judge = await runAssessmentJudge(intakeText, items);

  for (let round = 1; round <= maxRounds; round++) {
    const gaps = identifyGapItems(judge, items);
    if (gaps.length === 0) break;

    const questions = await generateFollowUpQuestions(
      intakeText,
      transcript,
      gaps,
      items,
      maxQuestionsPerRound
    );
    if (questions.length === 0) break;

    let counselorStopped = false;
    for (const q of questions) {
      const answer = (await ask(`\n[AIからの確認] ${q.question}\n> `)).trim();
      if (!answer || STOP_WORDS.test(answer)) {
        counselorStopped = true;
        break;
      }
      transcript.push({ role: "assistant", text: q.question });
      transcript.push({ role: "user", text: answer });
    }

    judge = await runAssessmentJudge(composeIntakeWithTranscript(intakeText, transcript), items);
    if (counselorStopped) break;
  }

  return { transcript, finalJudge: judge };
}

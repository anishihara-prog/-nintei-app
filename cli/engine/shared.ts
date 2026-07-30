/**
 * CLI用: Gemini API呼び出しの共通処理
 * assessmentEngine.ts（判定）・reviewEngine.ts（特記事項アドバイザー）・chatEngine.ts（確認チャット）から共有される。
 */

import { GoogleGenAI } from "@google/genai";

export const createGeminiClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY環境変数が設定されていません。.envファイルを確認してください。"
    );
  }
  return new GoogleGenAI({ apiKey });
};

export const getGeminiModel = (): string =>
  process.env.GEMINI_MODEL || "gemini-3.5-flash";

// 「障害支援区分に関するQ&A」「認定調査項目判断基準」（研修資料）より、
// 特定の項目に限らず全項目に共通する判断の考え方・特記事項の書き方のポイントをまとめたもの。
// server/index.js の COMMON_JUDGMENT_NOTES と同一。
export const COMMON_JUDGMENT_NOTES = `--- 共通の判断基準（Q&A・研修資料より） ---
【支援拒否・本来行うべき支援】
・本人が支援を拒否するため、本来であれば行うべき支援が行えていない場合は、「実際に行われている支援」ではなく「本来行うべき支援」に基づき判断する。ただし、日常生活の状況や、本来行うべき支援について本人・家族等から聞き取った内容を特記事項に記載する必要がある。

【福祉用具の使用】
・補装具等の福祉用具を使用している場合は「使用している状況」に基づき判断するが、日常生活とは異なる環境（慣れていない状況や初めての場所等）では使用できない福祉用具である場合など「できない状況」があるときは、その環境で必要とされる支援の内容を確認し、選択肢2〜4のいずれかを選択するとともに、日常生活の状況を特記事項に記載する。

【一時的な事情による行為の中断（てんかん発作等）】
・普段は支援がなくても行為ができるが、てんかん発作等が生じた場合に行為が中止・中断し、その発作に対する介助等が行われる場合は、一律に「支援が不要」とせず、行為の中で生じうる支援（例：転倒発作に対する見守り等）の必要性を確認するとともに、症状や頻度等を特記事項に記載する。

【できたりできなかったりする場合】
・「できたりできなかったりする場合」は「できない状況」に基づき判断する。運動機能の低下に限らず、知的・精神・発達障害による行動上の障害や、内部障害・難病等の筋力低下・易疲労感等によって「できない場合」、慣れていない状況や初めての場所等で「できない場合」も含めて判断し、その頻度や支援の詳細な状況を特記事項に記載する。

【想定環境】
・日常生活関係の項目は、施設入所や家族との同居等、普段過ごしている環境ではなく「自宅・単身」を想定して判断する。現在の生活環境と想定環境が異なる場合は、「自宅・単身を想定した上で」等のフレーズを用いて特記事項に明記する。

【練習・訓練で対応している場合】
・何度か練習や訓練等を行えば支援なく行為の全てができるようになると見込まれる場合は、「練習や訓練等という支援」が必要であることから選択肢2または3を選択し、日常生活の状況を特記事項に記載する。ただし、既に練習や訓練の成果で支援なく行える場合はその状況に基づき判断し、単なる未経験でできない場合は含まない。

【特記事項の書き方のポイント】
・二次判定で区分変更の根拠にできるのは特記事項のみ。一次判定結果が実態に合わないと思われても、特記事項に記載がなければ審査会委員は判断できない。支援の量を左右しそうな情報はできる限り拾って記載する。
・審査会委員は特記事項を読んで対象者の状態をイメージする。選択肢だけでは拾いきれない支援の内容、選択の根拠、実際に行われている支援の頻度等を詳細に記載する（同じ「見守り」でも、ただ見ているだけか、いつでも手を出せる用意をしながら見ているかで支援の度合いが異なる。同じ「部分支援」でも頻度により度合いが異なる）。
・「支援が不要」「全面的な支援が必要」であっても、必要に応じて具体的な状況や支援の内容を特記事項に記載する。記載がないと、一次判定結果の修正・区分変更・再調査の要否を審査会が判断できない。
・行動障害に関する項目は、生じている行動障害の内容だけでなく、行われている支援の内容や具体的な頻度（週1回なのか4回なのか等）も記載する。行動上の障害が生じないように行っている支援や配慮、投薬等の頻度も含めて判断・記載する。
・「〜と判断した」「〜と考えられた」等のフレーズを使い、選択の根拠を明確に記載する（記載なし、または曖昧な記述は審査会委員が判断できない）。
・前回調査時と状況が変わった場合は、その変化の理由・経緯も記載する。
--- ここまで ---`;

export interface CallGeminiOptions {
  maxOutputTokens?: number;
  thinkingBudget?: number;
}

/**
 * Gemini APIへJSON出力を期待するプロンプトを送り、パース済みの値を返す。
 * generateContent呼び出し＋JSON.parseのボイラープレートを一箇所にまとめたもの。
 */
export async function callGeminiJSON(
  prompt: string,
  opts: CallGeminiOptions = {}
): Promise<unknown> {
  const client = createGeminiClient();
  const config: Record<string, unknown> = { responseMimeType: "application/json" };
  if (opts.maxOutputTokens !== undefined) {
    config.maxOutputTokens = opts.maxOutputTokens;
  }
  if (opts.thinkingBudget !== undefined) {
    config.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  }

  const response = await client.models.generateContent({
    model: getGeminiModel(),
    contents: prompt,
    config,
  });

  const raw = response.text ?? "";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Gemini応答のJSON解析に失敗しました: ${raw.slice(0, 500)}`);
  }
}

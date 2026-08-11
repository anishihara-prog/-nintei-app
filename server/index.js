import express from "express";
import cors from "cors";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8787;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "[server] GEMINI_API_KEY が未設定です。.env に GEMINI_API_KEY=... を設定してください。"
  );
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// 「障害支援区分に関するQ&A」「認定調査項目判断基準」（研修資料）より、
// 特定の項目に限らず全項目に共通する判断の考え方・特記事項の書き方のポイントをまとめたもの。
const COMMON_JUDGMENT_NOTES = `--- 共通の判断基準（Q&A・研修資料より） ---
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

function formatOtherCriteria(allOptions, allCriteria, selectedOption) {
  if (!Array.isArray(allOptions) || !allCriteria) return "";
  return allOptions
    .filter((opt) => opt !== selectedOption)
    .map((opt) => `"${opt}"(基準:"${(allCriteria[opt] || "なし").replace(/\n/g, " ")}")`)
    .join(" / ");
}

function buildReviewPrompt(disabilityGrade, items) {
  const itemLines = items
    .map((it) => {
      const base =
        `- id:"${it.itemId}" 群:"${it.category}" 項目名:"${it.name}" 選択された判定:"${it.option}" ` +
        `判定基準:"${(it.criteria || "").replace(/\n/g, " ")}" 相談員が書いた特記文:"${it.text}"`;

      if (Array.isArray(it.perItemCriteria) && it.perItemCriteria.length > 0) {
        const comparisons = it.perItemCriteria
          .map((p) => {
            const other = formatOtherCriteria(p.allOptions, p.allCriteria, p.selectedOption);
            return other ? `  ・${p.name}(id:"${p.itemId}") の他の選択肢: ${other}` : "";
          })
          .filter(Boolean)
          .join("\n");
        return comparisons ? `${base}\n${comparisons}` : base;
      }

      const other = formatOtherCriteria(it.allOptions, it.allCriteria, it.option);
      return other ? `${base}\n  ・他の選択肢: ${other}` : base;
    })
    .join("\n");

  return `あなたは障害支援区分の認定調査における特記事項を、市町村審査会に提出する前にチェックする専門家です。
相談員が書いた特記事項が審査会で差し戻されないよう、助言（指摘）のみを行ってください。文章の書き換えは行わないでください。

対象者の障害等級（参考情報。空欄の場合もあります）：
${disabilityGrade || "（未入力）"}

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

app.post("/api/review", async (req, res) => {
  try {
    const { disabilityGrade, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items は必須です。" });
    }
    if (typeof disabilityGrade !== "undefined" && typeof disabilityGrade !== "string") {
      return res.status(400).json({ error: "disabilityGrade は文字列である必要があります。" });
    }

    const prompt = buildReviewPrompt(disabilityGrade || "", items);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const raw = response.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[server] Gemini応答のJSON解析に失敗:", raw.slice(0, 500));
      return res.status(502).json({ error: "AIの応答を解析できませんでした。" });
    }

    const validIds = new Set(items.map((it) => it.itemId));
    const comments = (Array.isArray(parsed) ? parsed : [])
      .filter((c) => c && typeof c.itemId === "string" && validIds.has(c.itemId))
      .map((c) => ({
        itemId: c.itemId,
        needsAttention: !!c.needsAttention,
        comment: typeof c.comment === "string" ? c.comment : "",
      }));

    res.json({ comments });
  } catch (err) {
    console.error("[server] /api/review error:", err);
    res.status(500).json({ error: "サーバー内部エラーが発生しました。" });
  }
});

function buildJudgePrompt(intakeText, items) {
  const itemLines = items
    .map((it) => {
      const criteriaLines = Object.entries(it.criteria || {})
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

app.post("/api/judge", async (req, res) => {
  try {
    const { intakeText, items } = req.body || {};
    if (typeof intakeText !== "string" || !intakeText.trim()) {
      return res.status(400).json({ error: "intakeText は必須です。" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items は必須です。" });
    }
    for (const it of items) {
      if (!it || typeof it.id !== "string" || !Array.isArray(it.options) || typeof it.defaultOption !== "string") {
        return res.status(400).json({ error: "items の形式が不正です。" });
      }
    }

    const prompt = buildJudgePrompt(intakeText, items);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[server] Gemini応答(judge)のJSON解析に失敗:", raw.slice(0, 500));
      return res.status(502).json({ error: "AIの応答を解析できませんでした。" });
    }

    const itemById = new Map(items.map((it) => [it.id, it]));
    const seen = new Set();
    const judgments = [];

    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (!entry || typeof entry.itemId !== "string") continue;
      const item = itemById.get(entry.itemId);
      if (!item) continue;

      const optionValid = typeof entry.option === "string" && item.options.includes(entry.option);
      const confidenceValid = ["explicit", "inferred", "unmentioned"].includes(entry.confidence);

      if (optionValid && confidenceValid && entry.confidence === "unmentioned") {
        // 本文に根拠がないとAI自身が申告した項目は、AIの提案を採用せずデフォルト値で上書きする。
        // 根拠のない重い判定が機械的に混入することを構造的に防ぐための安全策。
        judgments.push({
          itemId: entry.itemId,
          option: item.defaultOption,
          confidence: "unmentioned",
          evidence: "",
          source: "default",
        });
      } else if (optionValid && confidenceValid) {
        judgments.push({
          itemId: entry.itemId,
          option: entry.option,
          confidence: entry.confidence,
          evidence: typeof entry.evidence === "string" ? entry.evidence : "",
          source: "ai",
        });
      } else {
        judgments.push({
          itemId: entry.itemId,
          option: item.defaultOption,
          confidence: null,
          evidence: "",
          source: "invalid",
        });
      }
      seen.add(entry.itemId);
    }

    // 応答に含まれなかった項目はデフォルト値で埋め、必ず全件を1:1で返す。
    const missingItemIds = [];
    for (const it of items) {
      if (seen.has(it.id)) continue;
      judgments.push({
        itemId: it.id,
        option: it.defaultOption,
        confidence: null,
        evidence: "",
        source: "invalid",
      });
      missingItemIds.push(it.id);
    }

    res.json({ judgments, missingItemIds });
  } catch (err) {
    console.error("[server] /api/judge error:", err);
    res.status(500).json({ error: "サーバー内部エラーが発生しました。" });
  }
});

const MAX_FOLLOWUP_QUESTIONS = 5;
const MAX_OPTIONS_PER_QUESTION = 5;

function buildFollowUpQuestionsPrompt(transcriptText, gapItems) {
  const itemLines = gapItems
    .map((it) => {
      const criteriaLines = Object.entries(it.criteria || {})
        .map(([opt, text]) => `    - "${opt}": ${(text || "").replace(/\n/g, " ")}`)
        .join("\n");
      return (
        `- id:"${it.id}" 群:"${it.category}" 項目名:"${it.name}" 現在の暫定判定:"${it.currentOption || ""}"（確信度:${it.confidence || "unmentioned"}）\n` +
        `  評価内容: ${it.description || ""} ${it.kitaGuide || ""}\n` +
        `  選択肢と判断基準:\n${criteriaLines}`
      );
    })
    .join("\n");

  return `あなたは障害支援区分の認定調査員を支援するAIです。
相談員が入力した「聞き取った状況」を読み、以下の項目は本文からの根拠が乏しく（未記載、または推測のみ）、判定の確信が持てません。
相談員が本人・家族に追加で確認できるよう、質問を作成してください。

${COMMON_JUDGMENT_NOTES}

--- これまでに聞き取った状況（追加のやり取りを含む） ---
${transcriptText}
--- ここまで ---

--- 確信が持てない項目 ---
${itemLines}
--- ここまで ---

次のルールに従って質問を作成してください。
- 項目1つにつき1問という機械的な聞き方は避け、生活場面（例：移動・食事や入浴等の日常生活・意思疎通・行動面・医療面）ごとに関連する複数の項目をまとめ、総合的な自然文の質問にすること（relatedItemIdsにまとめた項目のidを列挙する）。
- 相談員が本人・家族にそのまま確認できる、具体的で自然な日本語の一文にする。
- 本文に書かれていないことを断定せず、あくまで確認のための質問にする。
- 他の記述から十分推測できる項目や重要度の低い項目は、無理に質問を作らなくてよい。
- 最大${MAX_FOLLOWUP_QUESTIONS}問まで（できるだけ少ない問数にまとめる）。確認すべきことがなければ空配列を返してよい。
- 相談員が本人・家族に読み上げてその場でタップ選択できるよう、なるべく選択肢（2〜5個、"options"）を用意すること。選択肢は「選択肢と判断基準」に沿った、回答が明確に分かれる短い言葉にする（例：「支えなしでできる」「見守りがあればできる」「介助が必要」「わからない」）。
- 数値・頻度・具体的なエピソードなど、選択肢では答えを表現しきれない質問に限り、"options"を空配列にして自由記述にしてよい（多用しない）。

出力は次のJSON形式の配列のみとしてください。前後に説明文やコードブロック記号（\`\`\`）は付けないでください。

[
  {
    "question": "相談員が本人・家族に確認するための質問文",
    "relatedItemIds": ["関連する項目のid（一覧に存在するものを厳密に一致させる）"],
    "options": ["選択肢1", "選択肢2", "…（自由記述にする場合は空配列 []）"]
  }
]`;
}

app.post("/api/judge/questions", async (req, res) => {
  try {
    const { intakeText, transcript, items } = req.body || {};
    if (typeof intakeText !== "string" || !intakeText.trim()) {
      return res.status(400).json({ error: "intakeText は必須です。" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items は必須です。" });
    }
    for (const it of items) {
      if (!it || typeof it.id !== "string" || typeof it.name !== "string") {
        return res.status(400).json({ error: "items の形式が不正です。" });
      }
    }
    if (typeof transcript !== "undefined" && !Array.isArray(transcript)) {
      return res.status(400).json({ error: "transcript は配列である必要があります。" });
    }

    const transcriptEntries = Array.isArray(transcript) ? transcript : [];
    const qaBlock = transcriptEntries
      .filter((t) => t && typeof t.question === "string" && typeof t.answer === "string")
      .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}`)
      .join("\n\n");
    const transcriptText =
      `${intakeText}` + (qaBlock ? `\n\n--- 追加の聞き取り ---\n${qaBlock}\n--- ここまで ---` : "");

    const prompt = buildFollowUpQuestionsPrompt(transcriptText, items);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[server] Gemini応答(judge/questions)のJSON解析に失敗:", raw.slice(0, 500));
      return res.status(502).json({ error: "AIの応答を解析できませんでした。" });
    }

    const validIds = new Set(items.map((it) => it.id));
    const questions = (Array.isArray(parsed) ? parsed : [])
      .filter((q) => q && typeof q.question === "string" && q.question.trim())
      .map((q) => ({
        question: q.question.trim(),
        relatedItemIds: Array.isArray(q.relatedItemIds)
          ? q.relatedItemIds.filter((id) => typeof id === "string" && validIds.has(id))
          : [],
        options: Array.isArray(q.options)
          ? q.options
              .filter((opt) => typeof opt === "string" && opt.trim())
              .map((opt) => opt.trim())
              .slice(0, MAX_OPTIONS_PER_QUESTION)
          : [],
      }))
      .filter((q) => q.relatedItemIds.length > 0)
      .slice(0, MAX_FOLLOWUP_QUESTIONS);

    res.json({ questions });
  } catch (err) {
    console.error("[server] /api/judge/questions error:", err);
    res.status(500).json({ error: "サーバー内部エラーが発生しました。" });
  }
});

const MAX_GROUP_SUGGESTIONS = 10;
const MAX_GROUP_SIZE = 5;

function buildGroupSuggestionPrompt(items) {
  const itemLines = items
    .map((it) => {
      const noteText = (it.text || "").trim().replace(/\n/g, " ") || "（未記入）";
      return (
        `- id:"${it.itemId}" 群:"${it.category}" 項目名:"${it.name}" 選択された判定:"${it.option}" ` +
        `判定基準:"${(it.criteria || "").replace(/\n/g, " ")}" 相談員が書いた特記文:"${noteText}"`
      );
    })
    .join("\n");

  return `あなたは障害支援区分の認定調査における特記事項の作成を支援する専門家です。
相談員がこれから複数の項目について特記事項を書きますが、内容が重複・類似しがちな項目をあらかじめ1つにまとめて書けるよう、グループ化の提案のみを行ってください。実際の特記文の作成・書き換えは行わないでください。

以下は「まだグループ化されていない」判定2以上の項目の一覧です（相談員がすでに特記文を入力している項目はその文面も併記します。未記入の項目もあります）。

--- 項目一覧 ---
${itemLines}
--- ここまで ---

${COMMON_JUDGMENT_NOTES}

次の観点で、内容が重複・類似しやすい項目同士をグループとして提案してください。
- **同じ「選択された判定」（選択肢の文字列）の項目同士のみをグループ化対象とする。判定が異なる項目を1つのグループに含めてはならない。** 支援の原因が似ていても、判定の水準が違えば特記文で描写すべき支援の程度が異なるため、まとめて1文にすると実態と食い違う記述になる。
- 支援の原因（同じ身体機能低下・同じ疾患・同じ行動障害等）が共通しており、特記文を別々に書くと同じ内容を繰り返すことになりそうな項目をまとめる
- 相談員がすでに特記文を入力している項目は、その文面が実際に重複・類似しているかを重視する（文面が実際には異なる内容であれば、群やカテゴリが同じでも無理に一緒にしない）
- まだ特記文が入力されていない項目は、項目名・判定基準・選択された判定の内容から重複が見込まれるかどうかで判断する
- 1グループは2項目以上、最大${MAX_GROUP_SIZE}項目までとする
- 明確に重複が見込まれる場合のみ提案する。すべての項目をどこかに割り当てる必要はない。まとめるべき組み合わせがなければ空配列を返してよい
- 提案は最大${MAX_GROUP_SUGGESTIONS}グループまで

出力は次のJSON形式の配列のみとしてください。前後に説明文やコードブロック記号（\`\`\`）は付けないでください。

[
  {
    "itemIds": ["一覧に存在するidを厳密に一致させて2件以上"],
    "reason": "まとめる理由の一言コメント（40字程度、日本語）"
  }
]`;
}

app.post("/api/judge/group-suggestions", async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items は必須です。" });
    }
    for (const it of items) {
      if (
        !it ||
        typeof it.itemId !== "string" ||
        typeof it.category !== "string" ||
        typeof it.name !== "string" ||
        typeof it.option !== "string"
      ) {
        return res.status(400).json({ error: "items の形式が不正です。" });
      }
    }
    if (items.length < 2) {
      return res.json({ suggestions: [] });
    }

    const prompt = buildGroupSuggestionPrompt(items);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[server] Gemini応答(group-suggestions)のJSON解析に失敗:", raw.slice(0, 500));
      return res.status(502).json({ error: "AIの応答を解析できませんでした。" });
    }

    const validIds = new Set(items.map((it) => it.itemId));
    const optionById = new Map(items.map((it) => [it.itemId, it.option]));

    // 判定（選択された選択肢）が異なる項目は、AIの提案に含まれていても同じグループにしない。
    // 判定ごとに分割し、2件以上残るまとまりだけを提案として残す。
    const suggestions = (Array.isArray(parsed) ? parsed : [])
      .flatMap((g) => {
        if (!g || !Array.isArray(g.itemIds)) return [];
        const uniqueValidIds = [...new Set(
          g.itemIds.filter((id) => typeof id === "string" && validIds.has(id))
        )];
        if (uniqueValidIds.length < 2) return [];

        const byOption = new Map();
        for (const id of uniqueValidIds) {
          const option = optionById.get(id);
          if (!byOption.has(option)) byOption.set(option, []);
          byOption.get(option).push(id);
        }

        const reason = typeof g.reason === "string" ? g.reason.trim() : "";
        return [...byOption.values()]
          .filter((ids) => ids.length >= 2)
          .map((ids) => ({ itemIds: ids.slice(0, MAX_GROUP_SIZE), reason }));
      })
      .slice(0, MAX_GROUP_SUGGESTIONS);

    res.json({ suggestions });
  } catch (err) {
    console.error("[server] /api/judge/group-suggestions error:", err);
    res.status(500).json({ error: "サーバー内部エラーが発生しました。" });
  }
});

function buildDraftNotePrompt(name, category, members, context) {
  const memberLines = members
    .map((m) => {
      return (
        `- 項目名:"${m.name}" 選択された判定:"${m.option}" ` +
        `判定基準:"${(m.criteria || "").replace(/\n/g, " ")}" 評価の着眼点:"${(m.kitaGuide || "").replace(/\n/g, " ")}"`
      );
    })
    .join("\n");

  const combineNote =
    members.length > 1
      ? "複数項目分の内容を1つの自然な文章にまとめてください。別々に書くと重複する内容（同じ原因・同じ支援内容の説明等）を繰り返さないようにしてください。"
      : "";

  return `あなたは障害支援区分の認定調査における特記事項の下書き作成を支援する専門家です。
以下は「${name}」（群:${category}）についての情報と、相談員が実際に聞き取った対象者の状況です。
聞き取った状況に書かれている具体的な事実（身体状況・生活歴・行動の特徴等）だけを根拠に、特記事項の下書き文案を1つ作成してください。
これはあくまで相談員が参考にするための下書きであり、実際の記入は相談員自身が行います。

--- 相談員が聞き取った対象者の状況 ---
${context || "（聞き取り内容は入力されていません）"}
--- ここまで ---

--- 対象項目の情報 ---
${memberLines}
--- ここまで ---

${COMMON_JUDGMENT_NOTES}

${combineNote}
選択された判定の水準に見合う、具体的な身体的理由・生活上の支障・介護（支援）の内容を含めてください。
**聞き取った状況に書かれていない事実（診断名・原因・具体的な数値等）を勝手に作り出さないこと。** 聞き取った状況だけでは根拠が薄い場合は、断定を避け「〜と考えられる」等の表現に留めるか、その旨がわかる書き方にしてください。

【聞き取り内容の読み方の注意】
・「聞き取った対象者の状況」に「Q:」「A:」形式の追加の聞き取りが含まれる場合、"Q:"は相談員が投げかけた質問文であり、事実ではない。質問文の中に「部分的な介助」「全面的な介助」等の選択肢の例示が含まれていても、それは単なる例示であり、本人の状態を表す事実として扱わないこと。事実として使えるのは"A:"（回答）に書かれている内容のみ。
・対象項目について"A:"に直接の回答がない場合、その項目に関する具体的な状態（できる／できない、程度、原因等）を勝手に補って書かないこと。

【選択された判定の水準との整合性】
・特記文で描写する支援の程度は、必ず「選択された判定:」に書かれた水準と一致させること。それより重い状態（例：見守り等が選択されているのに「自力では不可能」「全介助」等と書く）や、それより軽い状態を描写してはならない。
・対象項目について聞き取った状況に直接の事実がない場合は、事実を創作せず、判定基準・評価の着眼点の文言をもとに、選択された水準の一般的な支援内容にとどまる範囲で簡潔に書くこと。

【文字数の厳守】
特記事項欄はA4縦・フォント10.5ptで1行に収まる全角45文字程度が上限。必ずこの文字数に収まるよう、要点（身体理由・支障・介護内容）だけを短く言い切ること。
・「〜という状況が見られ」「〜と考えられることから」のような前置き・接続の言い回しは削り、体言止めや簡潔な言い方でつなげる。
・同じ内容を2度言わない。判定根拠として必須ではない事実は省く。
・良い例（45字程度）：「屋外歩行時にふらつきがあり、外出時は家族が付き添い腕を支えている。」
・悪い例（長すぎる。前置きと重複説明を含む）：「本人は屋外において時々ふらつくことがあり、そのため外出する際には家族が付き添って腕を支える介助を行っている状況である。」
どうしても45字では必須の事実（頻度・程度・具体的な支援内容など）を書き切れない場合に限り、60字程度までの超過を許容する。それ以上は許容しない。

出力は下書き文そのものだけにしてください。前後の説明文、見出し、引用符、コードブロック記号（\`\`\`）は一切付けないでください。`;
}

app.post("/api/judge/draft-note", async (req, res) => {
  try {
    const { name, category, members, context } = req.body || {};
    if (typeof name !== "string" || typeof category !== "string") {
      return res.status(400).json({ error: "name・category は必須です。" });
    }
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "members は必須です。" });
    }
    for (const m of members) {
      if (!m || typeof m.name !== "string" || typeof m.option !== "string") {
        return res.status(400).json({ error: "members の形式が不正です。" });
      }
    }
    if (typeof context !== "undefined" && typeof context !== "string") {
      return res.status(400).json({ error: "context は文字列である必要があります。" });
    }

    const prompt = buildDraftNotePrompt(name, category, members, context || "");

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const draft = (response.text ?? "").trim();
    res.json({ draft });
  } catch (err) {
    console.error("[server] /api/judge/draft-note error:", err);
    res.status(500).json({ error: "サーバー内部エラーが発生しました。" });
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

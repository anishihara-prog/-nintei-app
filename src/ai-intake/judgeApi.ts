// /api/judge 呼び出し用のヘルパー。
// このファイルは src/ai-intake/App.tsx 内の ASSESSMENT_ITEMS / OPTION_CRITERIA /
// INITIAL_SELECTIONS を引数として受け取るだけで、データそのものは持たない
// （src/App.tsx 側の同名データとは別物として複製管理されている点に注意）。

export type Confidence = "explicit" | "inferred" | "unmentioned" | null;
export type JudgeSource = "ai" | "default" | "invalid";

export type JudgeMeta = {
  source: JudgeSource;
  confidence: Confidence;
  evidence: string;
  manuallyOverridden: boolean;
};

export type JudgeRequestItem = {
  id: string;
  category: string;
  name: string;
  description: string;
  kitaGuide: string;
  options: string[];
  criteria: Record<string, string>;
  defaultOption: string;
};

type JudgeResponseEntry = {
  itemId: string;
  option: string;
  confidence: Confidence;
  evidence: string;
  source: JudgeSource;
};

export type JudgeResult = {
  selections: Record<string, string>;
  meta: Record<string, JudgeMeta>;
};

type AssessmentItemLike = {
  id: string;
  category: string;
  name: string;
  description: string;
  kitaGuide: string;
  options: string[];
};

export function buildJudgeRequestItems(
  items: AssessmentItemLike[],
  optionCriteria: Record<string, Record<string, string>>,
  initialSelections: Record<string, string>
): JudgeRequestItem[] {
  return items.map((item) => ({
    id: item.id,
    category: item.category,
    name: item.name,
    description: item.description,
    kitaGuide: item.kitaGuide,
    options: item.options,
    criteria: optionCriteria[item.id] || {},
    defaultOption: initialSelections[item.id] || item.options[0],
  }));
}

export async function runJudge(
  intakeText: string,
  requestItems: JudgeRequestItem[]
): Promise<JudgeResult> {
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intakeText, items: requestItems }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `判定リクエストに失敗しました（HTTP ${res.status}）`);
  }

  const data = await res.json();
  const judgments: JudgeResponseEntry[] = Array.isArray(data?.judgments) ? data.judgments : [];

  const byId = new Map(requestItems.map((it) => [it.id, it]));
  const selections: Record<string, string> = {};
  const meta: Record<string, JudgeMeta> = {};

  for (const entry of judgments) {
    const reqItem = byId.get(entry.itemId);
    if (!reqItem) continue;

    // クライアント側の防御的二重チェック：サーバーが検証済みのはずだが、
    // 万一不正な選択肢文字列が来てもUIが壊れないようにする。
    const optionValid = reqItem.options.includes(entry.option);
    const option = optionValid ? entry.option : reqItem.defaultOption;
    const source: JudgeSource = optionValid ? entry.source : "invalid";

    selections[entry.itemId] = option;
    meta[entry.itemId] = {
      source,
      confidence: source === "ai" ? entry.confidence : null,
      evidence: entry.evidence || "",
      manuallyOverridden: false,
    };
  }

  // 応答に含まれなかった項目（欠落）はデフォルト値で埋める。
  for (const reqItem of requestItems) {
    if (selections[reqItem.id] !== undefined) continue;
    selections[reqItem.id] = reqItem.defaultOption;
    meta[reqItem.id] = {
      source: "invalid",
      confidence: null,
      evidence: "",
      manuallyOverridden: false,
    };
  }

  return { selections, meta };
}

export type TranscriptEntry = { question: string; answer: string };

export type FollowUpQuestion = { question: string; relatedItemIds: string[]; options: string[] };

export type GapItem = JudgeRequestItem & {
  currentOption: string;
  confidence: Confidence;
};

/**
 * 判定の確信が持てない項目（本文に明記されていない・推測のみ・無効応答）を抽出する。
 * すでに人が手動修正した項目（manuallyOverridden）は対象外。
 */
export function identifyGapItems(
  meta: Record<string, JudgeMeta>,
  requestItems: JudgeRequestItem[],
  selections: Record<string, string>
): GapItem[] {
  return requestItems
    .filter((it) => {
      const m = meta[it.id];
      if (!m) return false;
      if (m.manuallyOverridden) return false;
      return m.confidence !== "explicit";
    })
    .map((it) => ({
      ...it,
      currentOption: selections[it.id] ?? it.defaultOption,
      confidence: meta[it.id]?.confidence ?? null,
    }));
}

export function composeIntakeWithTranscript(
  intakeText: string,
  transcript: TranscriptEntry[]
): string {
  if (transcript.length === 0) return intakeText;
  const qaBlock = transcript
    .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}`)
    .join("\n\n");
  return `${intakeText}\n\n--- 追加の聞き取り ---\n${qaBlock}\n--- ここまで ---`;
}

export async function runGenerateFollowUpQuestions(
  intakeText: string,
  transcript: TranscriptEntry[],
  gapItems: GapItem[]
): Promise<FollowUpQuestion[]> {
  if (gapItems.length === 0) return [];

  const res = await fetch("/api/judge/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intakeText, transcript, items: gapItems }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `質問生成リクエストに失敗しました（HTTP ${res.status}）`);
  }

  const data = await res.json();
  const validIds = new Set(gapItems.map((it) => it.id));
  const raw: FollowUpQuestion[] = Array.isArray(data?.questions) ? data.questions : [];

  // クライアント側の防御的二重チェック（サーバーの検証済みのはずだが念のため）。
  return raw
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .map((q) => ({
      question: q.question.trim(),
      relatedItemIds: Array.isArray(q.relatedItemIds) ? q.relatedItemIds.filter((id) => validIds.has(id)) : [],
      options: Array.isArray(q.options)
        ? q.options.filter((opt): opt is string => typeof opt === "string" && opt.trim().length > 0)
        : [],
    }))
    .filter((q) => q.relatedItemIds.length > 0);
}

export type GroupSuggestionItem = {
  itemId: string;
  category: string;
  name: string;
  option: string;
  criteria: string;
  text: string;
};

export type GroupSuggestion = {
  itemIds: string[];
  reason: string;
};

export async function runSuggestGroups(
  items: GroupSuggestionItem[]
): Promise<GroupSuggestion[]> {
  if (items.length < 2) return [];

  const res = await fetch("/api/judge/group-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `まとめ方提案リクエストに失敗しました（HTTP ${res.status}）`);
  }

  const data = await res.json();
  const validIds = new Set(items.map((it) => it.itemId));
  const raw: GroupSuggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];

  // クライアント側の防御的二重チェック（サーバーの検証済みのはずだが念のため）。
  return raw
    .filter((g) => g && Array.isArray(g.itemIds))
    .map((g) => ({
      itemIds: [...new Set(g.itemIds.filter((id) => typeof id === "string" && validIds.has(id)))],
      reason: typeof g.reason === "string" ? g.reason : "",
    }))
    .filter((g) => g.itemIds.length >= 2);
}

export type DraftNoteMember = {
  name: string;
  option: string;
  criteria: string;
  kitaGuide: string;
};

export async function runSuggestDraftNote(
  name: string,
  category: string,
  members: DraftNoteMember[],
  context: string
): Promise<string> {
  const res = await fetch("/api/judge/draft-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, category, members, context }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `下書き提案リクエストに失敗しました（HTTP ${res.status}）`);
  }

  const data = await res.json();
  return typeof data?.draft === "string" ? data.draft : "";
}

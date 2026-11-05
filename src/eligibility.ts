// 行動援護及び重度障害者等包括支援の判断基準表に基づく判定ロジック

export const BEHAVIOR_ITEM_IDS = [
  "3-3", "3-4", "4-7", "4-16", "4-19", "4-20",
  "4-21", "4-22", "4-23", "4-24", "4-25",
] as const;

export const HOMON_BODY_ITEM_IDS = ["1-4", "1-8", "2-4", "2-5"] as const;

const FREQUENCY_POINTS: Record<string, number> = {
  "1.支援不要": 0,
  "2.希に支援": 0,
  "3.月に1回以上支援": 0,
  "4.週に1回以上支援": 1,
  "5.ほぼ毎日支援": 2,
};

const COMMUNICATION_POINTS: Record<string, number> = {
  "生活に支障なし": 0,
  "特定の者なら可": 1,
  "会話以外で可": 1,
  "独自の方法で可": 2,
  "できない": 2,
};

const UNDERSTANDING_POINTS: Record<string, number> = {
  "理解できる": 0,
  "理解できない": 1,
  "判断不能": 2,
};

export const behaviorItemPoints = (itemId: string, option: string | undefined): number => {
  if (!option) return 0;
  if (itemId === "3-3") return COMMUNICATION_POINTS[option] ?? 0;
  if (itemId === "3-4") return UNDERSTANDING_POINTS[option] ?? 0;
  return FREQUENCY_POINTS[option] ?? 0;
};

export const HOMON_MENTAL_THRESHOLD = 10;
export const ACTION_SUPPORT_THRESHOLD = 10;
export const SEVERE_BEHAVIOR_THRESHOLD = 14;

export const BEHAVIOR_MAX_SCORE = BEHAVIOR_ITEM_IDS.length * 2;

export const calcBehaviorScore = (selections: Record<string, string>) => {
  const details = BEHAVIOR_ITEM_IDS.map(id => ({
    id,
    points: behaviorItemPoints(id, selections[id]),
  }));
  const total = details.reduce((sum, d) => sum + d.points, 0);
  return {
    details,
    total,
    homonMentalMet: total >= HOMON_MENTAL_THRESHOLD,
    actionSupportScoreMet: total >= ACTION_SUPPORT_THRESHOLD,
    severeBehaviorMet: total >= SEVERE_BEHAVIOR_THRESHOLD,
  };
};

// 身体：移乗・歩行・排尿・排便がいずれも「支援不要」以外
export const judgeHomonBody = (selections: Record<string, string>) => {
  const needsSupport = HOMON_BODY_ITEM_IDS.map(id => ({
    id,
    needed: !!selections[id] && !selections[id].startsWith("1."),
  }));
  const allNeeded = needsSupport.every(i => i.needed);
  return { needsSupport, allNeeded, met: allNeeded };
};

// 重度訪問介護：身体要件 または 知的・精神要件（区分4以上は出力後に目視で確認する）
export const judgeHomon = (bodyMet: boolean, mentalMet: boolean) => bodyMet || mentalMet;

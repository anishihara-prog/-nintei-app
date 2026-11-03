import { describe, it, expect } from "vitest";
import { calcBehaviorScore, judgeHomonBody, judgeHomon } from "../../src/eligibility";

describe("calcBehaviorScore", () => {
  it("sums points per criteria table", () => {
    const r = calcBehaviorScore({
      "3-3": "できない", "3-4": "判断不能",
      "4-7": "5.ほぼ毎日支援", "4-16": "4.週に1回以上支援",
      "4-19": "3.月に1回以上支援",
    });
    expect(r.total).toBe(2 + 2 + 2 + 1 + 0);
  });
});

describe("judgeHomonBody", () => {
  const all = { "1-4": "2.見守り等", "1-8": "3.部分支援", "2-4": "2.見守り等", "2-5": "4.全面支援" };
  it("requires paralysis and all four items", () => {
    expect(judgeHomonBody(all, true).met).toBe(true);
    expect(judgeHomonBody(all, false).met).toBe(false);
    expect(judgeHomonBody({ ...all, "2-5": "1.支援不要" }, true).met).toBe(false);
  });
});

describe("thresholds", () => {
  it("10 for homon mental, 14 for severe behavior", () => {
    const sel: Record<string, string> = { "3-3": "できない", "3-4": "判断不能" };
    for (const id of ["4-7", "4-16", "4-19"]) sel[id] = "5.ほぼ毎日支援";
    let r = calcBehaviorScore(sel);
    expect(r.total).toBe(10);
    expect(r.homonMentalMet).toBe(true);
    expect(r.severeBehaviorMet).toBe(false);
    for (const id of ["4-20", "4-21"]) sel[id] = "5.ほぼ毎日支援";
    r = calcBehaviorScore(sel);
    expect(r.severeBehaviorMet).toBe(true);
  });
  it("homon is body or mental", () => {
    expect(judgeHomon(true, false)).toBe(true);
    expect(judgeHomon(false, true)).toBe(true);
    expect(judgeHomon(false, false)).toBe(false);
  });
});

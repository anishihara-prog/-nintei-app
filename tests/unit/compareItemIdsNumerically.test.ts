import { describe, it, expect } from "vitest";
import { compareItemIdsNumerically } from "../../src/exportExcel";

describe("compareItemIdsNumerically", () => {
  it("項目番号の昇順になる（文字列順ではなく数値順）", () => {
    const ids = ["1-11", "1-1", "1-4", "1-2", "1-10"];
    expect([...ids].sort(compareItemIdsNumerically)).toEqual(["1-1", "1-2", "1-4", "1-10", "1-11"]);
  });

  it("区分（群番号）が異なる場合も数値順になる", () => {
    const ids = ["2-1", "1-11", "1-1"];
    expect([...ids].sort(compareItemIdsNumerically)).toEqual(["1-1", "1-11", "2-1"]);
  });
});

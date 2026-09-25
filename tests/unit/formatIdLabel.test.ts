import { describe, it, expect } from "vitest";
import { formatIdLabel } from "../../src/exportExcel";

describe("formatIdLabel", () => {
  it("単一項目は「( id )」の形式になる", () => {
    expect(formatIdLabel(["1-1"], "1.移動や動作等")).toBe("( 1-1 )");
  });

  it("同じ群番号の複数項目は「( 群-番号,番号,... )」にまとめられる", () => {
    expect(formatIdLabel(["1-4", "1-5", "1-6"], "1.移動や動作等")).toBe("( 1-4,5,6 )");
  });

  it("4群（行動障害）は全角括弧・詰め表記になる", () => {
    expect(formatIdLabel(["4-1"], "4.行動障害等")).toBe("（4-1）");
    expect(formatIdLabel(["4-1", "4-2", "4-3"], "4.行動障害等")).toBe("（4-1,2,3）");
  });

  it("区分をまたぐ（群番号が異なる）項目は個別の括弧を並べる", () => {
    expect(formatIdLabel(["1-11", "5-1"], "1.移動や動作等")).toBe("( 1-11 ) ( 5-1 )");
  });
});

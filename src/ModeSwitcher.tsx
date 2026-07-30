import { useState } from "react";
import App from "./App";
import AiIntakeApp from "./ai-intake/App";

type Mode = "manual" | "ai-intake";

export default function ModeSwitcher() {
  const [mode, setMode] = useState<Mode>("manual");

  return (
    <div>
      <div className="bg-slate-950 text-slate-300 text-xs">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
          <button
            onClick={() => setMode("manual")}
            className={`px-4 py-2 font-bold border-b-2 transition-all ${
              mode === "manual"
                ? "border-emerald-400 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            項目ごとに入力
          </button>
          <button
            onClick={() => setMode("ai-intake")}
            className={`px-4 py-2 font-bold border-b-2 transition-all ${
              mode === "ai-intake"
                ? "border-indigo-400 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            聞き取りからAIで一括作成
          </button>
        </div>
      </div>
      {mode === "manual" ? <App /> : <AiIntakeApp />}
    </div>
  );
}

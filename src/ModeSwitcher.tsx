import { useState } from "react";
import App from "./App";
import AiIntakeApp from "./ai-intake/App";

type Mode = "manual" | "numeric" | "ai-intake";

const TABS: { mode: Mode; label: string }[] = [
  { mode: "manual", label: "項目ごとに入力(調査票シート順)" },
  { mode: "numeric", label: "項目ごとに入力(順番通り)" },
];

export default function ModeSwitcher() {
  const [mode, setMode] = useState<Mode>("manual");

  return (
    <div>
      <div className="bg-slate-950 text-slate-300 text-xs">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab.mode}
              onClick={() => setMode(tab.mode)}
              className={`px-4 py-2 font-bold border-b-2 transition-all ${
                mode === tab.mode
                  ? "border-emerald-400 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {mode === "ai-intake" ? (
        <AiIntakeApp />
      ) : (
        <App key={mode} order={mode === "numeric" ? "numeric" : "sheet"} />
      )}
    </div>
  );
}

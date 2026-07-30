#!/usr/bin/env node

/**
 * 認定調査CLI: 認定調査票自動作成ツール
 * セッション・エクスポート結果はローカルにのみ保存される。
 * AI判定・確認チャット・特記事項チェックの際はGemini APIへの通信が発生する。
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import {
  formatJudgeResults,
  ASSESSMENT_ITEMS,
} from "./assessmentEngine.js";
import { SessionManager, type AssessmentSession } from "./sessionManager.js";
import { runGapFillingChat } from "./engine/chatEngine.js";
import { runSpecialNotesReview, formatReviewComments } from "./engine/reviewEngine.js";

const sessionManager = new SessionManager(".nintei");
let currentSession: AssessmentSession | null = null;

// CLIインターフェース
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

// バナー表示
function showBanner(): void {
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     認定調査票 自動作成ツール (CLI版)                        ║");
  console.log("║     データはローカルに保存（AI利用時はGemini APIへ通信）    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();
}

// メニュー表示
async function showMainMenu(): Promise<void> {
  console.log("\n【メインメニュー】");
  console.log("1. 新しい認定調査を開始");
  console.log("2. 前回のセッションを再開");
  console.log("3. セッション一覧を表示");
  console.log("4. 終了");

  const choice = await question("\n選択してください (1-4): ");

  switch (choice) {
    case "1":
      await startNewAssessment();
      break;
    case "2":
      await resumeSession();
      break;
    case "3":
      await listSessions();
      break;
    case "4":
      console.log("\n終了します。");
      rl.close();
      process.exit(0);
    default:
      console.log("無効な選択です");
      await showMainMenu();
  }
}

// 新規認定調査開始
async function startNewAssessment(): Promise<void> {
  console.log("\n【新しい認定調査を開始】");

  const clientName = await question("利用者名を入力してください: ");
  const age = await question("年齢を入力してください (オプション): ");
  const notes = await question("備考を入力してください (オプション): ");

  currentSession = sessionManager.createSession(clientName);
  currentSession.clientInfo.age = age ? parseInt(age) : undefined;
  currentSession.clientInfo.notes = notes || undefined;

  sessionManager.saveSession(currentSession);

  console.log(
    `\nセッションを作成しました。ID: ${currentSession.id.substring(0, 20)}...`
  );

  await inputIntakeText();
}

// 聞き取り内容を入力
async function inputIntakeText(): Promise<void> {
  console.log("\n【聞き取り内容の入力】");
  console.log("調査の際に聞き取った内容を、以下に貼り付けてください。");
  console.log("入力完了後、空行を入力して次に進んでください。\n");

  let intakeText = "";
  let lineCount = 0;

  // 複数行入力
  while (true) {
    const line = await question("");
    if (line === "" && lineCount > 0) {
      break;
    }
    if (line !== "" || intakeText !== "") {
      intakeText += line + "\n";
      lineCount++;
    }
  }

  if (!currentSession) {
    console.error("セッションエラー");
    return;
  }

  currentSession.intakeText = intakeText.trim();
  sessionManager.saveSession(currentSession);

  console.log("\n聞き取り内容を保存しました。");
  console.log(
    `入力テキスト長: ${currentSession.intakeText.length} 文字\n`
  );

  await startAIJudgement();
}

// AI確認チャット＆自動判定
async function startAIJudgement(): Promise<void> {
  if (!currentSession) {
    console.error("セッションエラー");
    return;
  }

  console.log("\n【AI確認チャット＆自動判定を開始】");
  console.log("Gemini APIを使用して、80項目を自動判定しています...");
  console.log("判定の甘い項目があれば、AIが確認の質問をします。（通常1-2分かかります）\n");

  try {
    const { transcript, finalJudge } = await runGapFillingChat(
      currentSession.intakeText,
      ASSESSMENT_ITEMS,
      question,
      { maxRounds: 3, maxQuestionsPerRound: 5 }
    );

    console.log(formatJudgeResults(finalJudge));

    // 判定結果と判定理由をセッションに保存
    finalJudge.results.forEach((r) => {
      currentSession!.judgements[r.itemId] = r.selectedOption;
      currentSession!.specialNotes[r.itemId] = r.reasoning;
    });
    currentSession.conversation = transcript;

    sessionManager.saveSession(currentSession);

    console.log("✅ AI判定が完了しました。");
    console.log("特記事項の編集画面に進みます...\n");

    await editSpecialNotes();
  } catch (error) {
    console.error("❌ AI判定エラー:", error);
    console.log("\n別の操作を選択してください。");
    await showMainMenu();
  }
}

// 特記事項の編集
async function editSpecialNotes(): Promise<void> {
  if (!currentSession) {
    console.error("セッションエラー");
    return;
  }

  console.log("\n【特記事項の編集】");
  console.log("AI判定に基づいて、特記事項を入力してください。");
  console.log("(編集後の内容は自動保存されます)\n");

  // 判定結果を表示
  console.log("【判定結果サマリー】");
  Object.entries(currentSession.judgements).forEach(([id, judgement]) => {
    console.log(`${id}: ${judgement}`);
  });

  // 項目ごとの特記事項入力
  console.log("\n項目ごとに特記事項を入力できます。項目ID（例: 1-4）を入力してください。");
  console.log("空Enterで次に進みます。");
  while (true) {
    const itemId = await question("\n項目ID（空Enterで終了）: ");
    if (!itemId.trim()) break;
    if (!currentSession.judgements[itemId]) {
      console.log("無効な項目IDです");
      continue;
    }
    const existing = currentSession.specialNotes[itemId] || "";
    if (existing) console.log(`現在の内容: ${existing}`);
    const text = await question("特記事項テキスト: ");
    if (text.trim()) currentSession.specialNotes[itemId] = text.trim();
    sessionManager.saveSession(currentSession);
  }

  // AIによる特記事項チェック（任意）
  const runReview = await question("\nAIによる特記事項チェックを実行しますか？ (y/N): ");
  if (/^y(es)?$/i.test(runReview.trim())) {
    await runReviewStep();
  }

  console.log("\n特記事項を入力してください (複数行可能):");
  const specialNote = await question("特記事項: ");

  currentSession.specialNotes["summary"] = specialNote;
  currentSession.status = "completed";
  sessionManager.saveSession(currentSession);

  console.log("✅ 特記事項を保存しました。\n");

  await exportResults();
}

// AIによる特記事項チェック（書き換えは行わず、助言のみ）
async function runReviewStep(): Promise<void> {
  if (!currentSession) return;

  console.log("\n【AIによる特記事項チェック】");
  try {
    const comments = await runSpecialNotesReview(currentSession, ASSESSMENT_ITEMS);
    console.log(formatReviewComments(comments));

    if (Object.keys(comments).length === 0) return;

    currentSession.reviewComments = comments;
    sessionManager.saveSession(currentSession);

    const needsAttention = Object.entries(comments).filter(([, c]) => c.needsAttention);
    if (needsAttention.length > 0) {
      const revise = await question(`\n${needsAttention.length}件の指摘があります。修正しますか？ (y/N): `);
      if (/^y(es)?$/i.test(revise.trim())) {
        for (const [itemId, c] of needsAttention) {
          console.log(`\n${itemId}: ${c.comment}`);
          console.log(`現在の内容: ${currentSession.specialNotes[itemId] || ""}`);
          const text = await question("修正後のテキスト（そのままEnterでスキップ）: ");
          if (text.trim()) currentSession.specialNotes[itemId] = text.trim();
        }
        sessionManager.saveSession(currentSession);
      }
    }
  } catch (error) {
    console.error("❌ AIチェックエラー:", error);
  }
}

// 結果をエクスポート
async function exportResults(): Promise<void> {
  if (!currentSession) {
    console.error("セッションエラー");
    return;
  }

  console.log("\n【結果のエクスポート】");
  console.log("1. JSON形式でダウンロード");
  console.log("2. CSV形式でダウンロード");
  console.log("3. メイン画面に戻る");

  const choice = await question("\n選択してください (1-3): ");

  const exportDir = ".nintei/exports";
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  switch (choice) {
    case "1": {
      const jsonData = sessionManager.exportToJSON(currentSession);
      const fileName = `assessment-${currentSession.clientInfo.name}-${Date.now()}.json`;
      const filePath = path.join(exportDir, fileName);
      fs.writeFileSync(filePath, jsonData);
      console.log(`✅ 出力ファイル: ${filePath}`);
      break;
    }
    case "2": {
      const csvData = sessionManager.exportToCSV(currentSession);
      const fileName = `assessment-${currentSession.clientInfo.name}-${Date.now()}.csv`;
      const filePath = path.join(exportDir, fileName);
      fs.writeFileSync(filePath, csvData);
      console.log(`✅ 出力ファイル: ${filePath}`);
      break;
    }
    case "3":
      break;
    default:
      console.log("無効な選択です");
  }

  await showMainMenu();
}

// セッションを再開
async function resumeSession(): Promise<void> {
  const sessions = sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log("\n保存されたセッションがありません。");
    await showMainMenu();
    return;
  }

  console.log("\n【セッション一覧】");
  sessions.forEach((session, index) => {
    const date = new Date(session.timestamp).toLocaleString("ja-JP");
    console.log(`${index + 1}. ${session.clientInfo.name} - ${date}`);
  });

  const choice = await question("\n再開するセッションを選択 (番号): ");
  const selectedIndex = parseInt(choice) - 1;

  if (selectedIndex >= 0 && selectedIndex < sessions.length) {
    currentSession = sessions[selectedIndex];
    console.log(
      `\n✅ セッションを再開しました: ${currentSession.clientInfo.name}\n`
    );
    await editSpecialNotes();
  } else {
    console.log("無効な選択です");
    await showMainMenu();
  }
}

// セッション一覧表示
async function listSessions(): Promise<void> {
  const sessions = sessionManager.listSessions();

  console.log("\n【保存されたセッション一覧】");
  if (sessions.length === 0) {
    console.log("セッションがありません");
  } else {
    sessions.forEach((session, index) => {
      const date = new Date(session.timestamp).toLocaleString("ja-JP");
      const status = session.status === "completed" ? "✅ 完了" : "⏳ 進行中";
      console.log(
        `${index + 1}. ${session.clientInfo.name} (${date}) [${status}]`
      );
    });
  }

  await showMainMenu();
}

// メイン処理
async function main(): Promise<void> {
  // .env ファイルの読み込み
  const envPath = ".env";
  if (!fs.existsSync(envPath)) {
    console.error("❌ エラー: .env ファイルが見つかりません。");
    console.error(".env.example をコピーして、GEMINI_API_KEY を設定してください。");
    process.exit(1);
  }

  // 環境変数の読み込み
  const env = fs.readFileSync(envPath, "utf-8");
  env.split("\n").forEach((line) => {
    const [key, value] = line.split("=");
    if (key && !process.env[key]) {
      process.env[key] = value?.trim();
    }
  });

  showBanner();
  await showMainMenu();
}

// エラーハンドリング
process.on("SIGINT", () => {
  console.log("\n\nアプリケーションを終了します。");
  rl.close();
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ エラーが発生しました:", error);
  process.exit(1);
});

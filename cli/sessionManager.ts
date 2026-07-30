/**
 * セッション管理: 認定調査データの保存・読み込み
 */

import fs from "fs";
import path from "path";

export interface ConversationTurn {
  role: "assistant" | "user";
  text: string;
}

export interface ReviewComment {
  needsAttention: boolean;
  comment: string;
}

export interface AssessmentSession {
  id: string;
  timestamp: string;
  clientInfo: {
    name: string;
    age?: number;
    notes?: string;
  };
  intakeText: string;
  judgements: Record<string, string>;
  specialNotes: Record<string, string>;
  status: "in-progress" | "completed";
  conversation?: ConversationTurn[];
  reviewComments?: Record<string, ReviewComment>;
}

export class SessionManager {
  private dataDir: string;

  constructor(dataDir = ".nintei") {
    this.dataDir = dataDir;
    this.ensureDataDirExists();
  }

  private ensureDataDirExists(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    const sessionsDir = path.join(this.dataDir, "sessions");
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
  }

  /**
   * 新しいセッションを作成
   */
  createSession(clientName: string): AssessmentSession {
    const session: AssessmentSession = {
      id: `session-${Date.now()}`,
      timestamp: new Date().toISOString(),
      clientInfo: {
        name: clientName,
      },
      intakeText: "",
      judgements: {},
      specialNotes: {},
      status: "in-progress",
    };
    return session;
  }

  /**
   * セッションを保存
   */
  saveSession(session: AssessmentSession): void {
    const sessionFile = path.join(
      this.dataDir,
      "sessions",
      `${session.id}.json`
    );
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), "utf-8");
  }

  /**
   * セッションを読み込み
   */
  loadSession(sessionId: string): AssessmentSession | null {
    const sessionFile = path.join(
      this.dataDir,
      "sessions",
      `${sessionId}.json`
    );
    if (!fs.existsSync(sessionFile)) {
      return null;
    }
    const data = fs.readFileSync(sessionFile, "utf-8");
    return JSON.parse(data);
  }

  /**
   * すべてのセッションをリスト
   */
  listSessions(): AssessmentSession[] {
    const sessionsDir = path.join(this.dataDir, "sessions");
    if (!fs.existsSync(sessionsDir)) {
      return [];
    }

    return fs
      .readdirSync(sessionsDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const data = fs.readFileSync(
          path.join(sessionsDir, file),
          "utf-8"
        );
        return JSON.parse(data);
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /**
   * セッションを削除
   */
  deleteSession(sessionId: string): void {
    const sessionFile = path.join(
      this.dataDir,
      "sessions",
      `${sessionId}.json`
    );
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  }

  /**
   * セッションを CSV に出力
   */
  exportToCSV(session: AssessmentSession): string {
    let csv = "項目ID,判定結果,特記事項\n";
    for (const [id, judgement] of Object.entries(session.judgements)) {
      const note = session.specialNotes[id] || "";
      csv += `"${id}","${judgement}","${note.replace(/"/g, '""')}"\n`;
    }
    return csv;
  }

  /**
   * セッションを JSON に出力
   */
  exportToJSON(session: AssessmentSession): string {
    return JSON.stringify(
      {
        client: session.clientInfo,
        timestamp: session.timestamp,
        judgements: session.judgements,
        specialNotes: session.specialNotes,
      },
      null,
      2
    );
  }
}

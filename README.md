# 認定調査票 特記事項1行自動作成システム

Google Gemini（AI Studio / Canvas）で作成された単一ファイル（1.tsx）を、
VS Code でそのまま動かして開発を続けられるように、実プロジェクトの形にしたものです。

## 直したこと（Geminiの環境では動いていたが、ローカルでは問題になりやすい箇所）

1. **Tailwindのクラス `w-5.5` `h-5.5`** は標準のTailwindには存在しないサイズです。
   `tailwind.config.js` の `spacing` に `"5.5"` を追加して対応しています。
2. **`animate-fadeIn` クラス**もTailwind標準にはありません。
   `src/index.css` に `@keyframes fadeIn` と `.animate-fadeIn` を追加しています。
3. Gemini Canvas は内部的に React / Tailwind / lucide-react を自動で読み込んでくれますが、
   ローカルではこれらを `package.json` で明示的にインストールする必要があります（今回のセットアップ済み）。

ロジック自体（判定→キーワード自動連結→1行特記生成）は良くできているので、変更していません。

## フォルダ構成

```
nintei-app/
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx       ← エントリーポイント
    ├── index.css      ← Tailwind読み込み + アニメーション定義
    └── App.tsx         ← 元の1.tsxの内容（本体ロジック）
```

## VS Codeでの始め方

1. このzipを解凍し、VS Codeで `nintei-app` フォルダを開く
2. ターミナルで依存パッケージをインストール
   ```
   npm install
   ```
3. 開発サーバーを起動
   ```
   npm run dev
   ```
4. 表示されたURL（通常 http://localhost:5173 ）をブラウザで開く

## Claude（Claude Code）で開発を続けるには

VS Code の拡張機能で **Claude Code** を入れると、このチャットと同じClaudeが
VS Code内であなたのファイルを直接読み書きしながら開発できます。

- VS Code拡張マーケットプレイスで "Claude Code" を検索してインストール
- インストール後、ターミナルや拡張のパネルから `claude` を起動し、
  「`src/App.tsx` に項目を追加して」「このバグを直して」のように指示するだけで
  ファイルを直接編集してもらえます
- 起動後に `npm run dev` を実行したままにしておくと、保存と同時に
  ブラウザの表示も自動更新されます（Vite HMR）

## AIレビュー機能（審査会向けチェック）

相談員が右側プレビュー欄に書いた特記事項を、Gemini APIが「審査会で差し戻されそうな
書き方になっていないか」の観点でレビューし、指摘コメントを返す機能です。
文章の書き換えは行わず、指摘のみを行います。

### セットアップ

1. `.env.example` を `.env` にコピーし、`GEMINI_API_KEY` を設定する
   （Google AI StudioまたはVertex AIのAPIキー。実データを扱う前に、
   自治体・団体側でのデータ保護契約の確認が必要です）
2. 依存パッケージをインストール（`@google/genai` 等を含む）
   ```
   npm install
   ```
3. フロントエンドとAPIサーバーを同時起動
   ```
   npm run dev:all
   ```
   （個別に起動する場合は `npm run dev` と `npm run server` を別ターミナルで）

### 使い方

1. 右側プレビュー欄の「障害等級」欄に概況調査票の等級を入力（任意）
2. 各項目を選択し、特記事項の文章を通常どおり記入
3. 「下の特記事項をAIでレビュー」を押すと、各項目の下に指摘コメントが表示される

### テスト用データ

`server/sample-dummy-cases.md` に架空のケースを12件用意しています。
実データではなく、これらを参考に自分で項目を選択・入力してテストしてください。

## 今後よくある追加要望（参考）

- 調査項目の追加（1-7, 1-9, 1-11, 2-2, 2-3, 2-5, 2-6, 3-2, 3-4〜3-7, 4群の他項目, 5群の他項目など、
  現状は全項目ではなく主要項目のみが定義されています）
- 入力内容のブラウザ保存（localStorageは使えないため、ファイル書き出し/読み込みでの保存機能などが必要）
- Excel/Wordへのそのままの貼り付け対応（文字数カウント表示など）

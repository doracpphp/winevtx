// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // チェック対象ファイル
  {
    files: ["src/**/*.ts"],
  },
  // TypeScript 推奨ルール
  ...tseslint.configs.recommended,
  // プロジェクト固有のカスタムルール
  {
    files: ["src/**/*.ts"],
    rules: {
      // 未使用変数はエラー（ただし _ プレフィックスは除外）
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // any 型の使用は警告
      "@typescript-eslint/no-explicit-any": "warn",
      // 一貫した型インポート（import type）を強制
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright çıktıları (Issue #132). Bunlar `.gitignore`'da zaten var ama ESLint
    // `.gitignore`'u KENDİLİĞİNDEN OKUMAZ; eklenmediklerinde `npm run test:e2e` sonrası
    // `npm run lint` üretilmiş rapor paketini tarayıp 3000'den fazla sahte sorun bildiriyor
    // ve gerçek bir lint hatası bu gürültünün içinde görünmez hâle geliyordu.
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "playwright/.cache/**",
  ]),
]);

export default eslintConfig;

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  // Blob images come from hermod-blob:// or object URLs: next/image cannot optimise them in a static export.
  { rules: { "@next/next/no-img-element": "off" } },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Vendored design-source reference copy (gitignored), not app code.
      "design-src/**",
      // Generated static sites the e2e runner serves per port, and Playwright's own output.
      ".e2e-site-*/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
];

export default eslintConfig;

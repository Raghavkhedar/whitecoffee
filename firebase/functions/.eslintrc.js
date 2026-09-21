module.exports = {
  env: {
    es2022: true,
    node: true,
  },
  parserOptions: {
    // ecmaVersion: 2018 parse-errored on ?., ??, and other modern syntax used
    // throughout index.js — bumped to "latest" so the linter actually parses the file.
    // The "google" style preset was removed alongside this: it enforced opinionated
    // formatting rules (max-len, jsdoc, etc.) that were never honoured in this codebase
    // and caused the lint script to be skipped entirely. What remains are the rules
    // that catch real bugs (eslint:recommended).
    ecmaVersion: "latest",
  },
  extends: [
    "eslint:recommended",
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    // Disabled: the codebase mixes arrow and regular callbacks intentionally.
    // "prefer-arrow-callback": "error",
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
  },
  overrides: [
    {
      files: ["**/*.test.*"],
      env: {
        node: true,
      },
      rules: {},
    },
  ],
  globals: {},
};

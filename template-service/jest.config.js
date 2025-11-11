module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  coverageDirectory: "./coverage",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.test.ts",
    "!src/test/**",
    "!src/migrations/**",
  ],
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
  testTimeout: 30000,
  verbose: true,
  globals: {
    "ts-jest": {
      isolatedModules: true,
    },
  },
};

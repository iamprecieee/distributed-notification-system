import {
  extractPlaceholders,
  validateVariables,
} from "./extract-placeholders.util";

describe("extractPlaceholders", () => {
  it("should extract placeholders from simple string", () => {
    const content = { body: "Hello {{name}}, welcome!" };
    const result = extractPlaceholders(content);
    expect(result).toEqual(["name"]);
  });

  it("should extract multiple placeholders", () => {
    const content = {
      title: "Welcome {{name}}!",
      body: "Hi {{name}}, click {{link}} to continue",
    };
    const result = extractPlaceholders(content);
    expect(result).toEqual(["link", "name"]);
  });

  it("should handle nested objects", () => {
    const content = {
      email: {
        subject: "Hello {{name}}",
        body: "Your code is {{code}}",
      },
    };
    const result = extractPlaceholders(content);
    expect(result).toEqual(["code", "name"]);
  });

  it("should handle placeholders with spaces", () => {
    const content = { body: "Hello {{ name }}, welcome!" };
    const result = extractPlaceholders(content);
    expect(result).toEqual(["name"]);
  });

  it("should handle dot notation", () => {
    const content = { body: "Hello {{user.name}}, from {{company.name}}" };
    const result = extractPlaceholders(content);
    expect(result).toEqual(["company.name", "user.name"]);
  });

  it("should return empty array for no placeholders", () => {
    const content = { body: "Hello world" };
    const result = extractPlaceholders(content);
    expect(result).toEqual([]);
  });

  it("should deduplicate placeholders", () => {
    const content = { body: "Hello {{name}}, bye {{name}}" };
    const result = extractPlaceholders(content);
    expect(result).toEqual(["name"]);
  });
});

describe("validateVariables", () => {
  it("should validate correct variables", () => {
    const content = {
      title: "Welcome {{name}}!",
      body: "Click {{link}}",
    };
    const variables = ["name", "link"];
    const result = validateVariables(content, variables);

    expect(result.isValid).toBe(true);
    expect(result.missingVariables).toEqual([]);
    expect(result.unusedVariables).toEqual([]);
  });

  it("should detect missing variables", () => {
    const content = {
      body: "Hello {{name}}, your code is {{code}}",
    };
    const variables = ["name"];
    const result = validateVariables(content, variables);

    expect(result.isValid).toBe(false);
    expect(result.missingVariables).toEqual(["code"]);
  });

  it("should detect unused variables", () => {
    const content = {
      body: "Hello {{name}}",
    };
    const variables = ["name", "unused", "extra"];
    const result = validateVariables(content, variables);

    expect(result.isValid).toBe(true);
    expect(result.unusedVariables).toEqual(["unused", "extra"]);
  });

  it("should handle empty content", () => {
    const content = { body: "No placeholders here" };
    const variables = ["name"];
    const result = validateVariables(content, variables);

    expect(result.isValid).toBe(true);
    expect(result.missingVariables).toEqual([]);
    expect(result.unusedVariables).toEqual(["name"]);
  });

  it("should handle empty variables array", () => {
    const content = { body: "Hello {{name}}" };
    const variables: string[] = [];
    const result = validateVariables(content, variables);

    expect(result.isValid).toBe(false);
    expect(result.missingVariables).toEqual(["name"]);
  });
});

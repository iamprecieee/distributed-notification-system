/**
 * Extracts all placeholders from template content using {{variable}} syntax
 * @param content - Object containing template fields (title, body, subject, etc.)
 * @returns Array of unique variable names found in the content
 */
export function extractPlaceholders(
  content: Record<string, unknown>
): string[] {
  const placeholderRegex = /{{\s*([\w.]+)\s*}}/g;
  const foundPlaceholders = new Set<string>();

  const searchContent = (obj: unknown): void => {
    if (typeof obj === "string") {
      let match: RegExpExecArray | null;
      while ((match = placeholderRegex.exec(obj)) !== null) {
        foundPlaceholders.add(match[1].trim());
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(searchContent);
    } else if (obj !== null && typeof obj === "object") {
      Object.values(obj).forEach(searchContent);
    }
  };

  searchContent(content);
  return Array.from(foundPlaceholders).sort();
}

/**
 * Validates that all placeholders in content are declared in variables array
 * @param content - Template content object
 * @param declaredVariables - Array of variable names that should be used
 * @returns Object with validation result and details
 */
export function validateVariables(
  content: Record<string, unknown>,
  declaredVariables: string[]
): {
  isValid: boolean;
  missingVariables: string[];
  unusedVariables: string[];
  foundPlaceholders: string[];
} {
  const foundPlaceholders = extractPlaceholders(content);
  const declaredSet = new Set(declaredVariables);
  const foundSet = new Set(foundPlaceholders);

  const missingVariables = foundPlaceholders.filter(
    (placeholder) => !declaredSet.has(placeholder)
  );

  const unusedVariables = declaredVariables.filter(
    (variable) => !foundSet.has(variable)
  );

  return {
    isValid: missingVariables.length === 0,
    missingVariables,
    unusedVariables,
    foundPlaceholders,
  };
}

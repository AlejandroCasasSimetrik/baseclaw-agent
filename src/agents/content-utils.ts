/**
 * Content Extraction Utilities
 *
 * Handles all LangChain message content formats:
 * - OpenAI: plain string
 * - Anthropic: array of content blocks [{type: "text", text: "..."}]
 * - Edge cases: null, undefined, object with .text
 */

/**
 * Extract text from any LangChain message content format.
 *
 * OpenAI returns content as a plain string.
 * Anthropic returns content as an array: [{type: "text", text: "..."}]
 * This function normalizes both into a plain string.
 */
export function extractTextContent(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .filter(
                (block: any) =>
                    typeof block === "string" ||
                    (block && typeof block === "object" && block.type === "text")
            )
            .map((block: any) =>
                typeof block === "string" ? block : (block.text ?? "")
            )
            .join("");
    }

    if (content && typeof content === "object" && "text" in content) {
        return String((content as any).text);
    }

    if (content === null || content === undefined) {
        return "";
    }

    return String(content);
}

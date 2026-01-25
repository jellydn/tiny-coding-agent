import { describe, it, expect } from "bun:test";
import { escapeXml } from "../../src/utils/xml.js";

describe("escapeXml", () => {
  describe("basic escaping", () => {
    it("should escape ampersand character", () => {
      const result = escapeXml("Tom & Jerry");
      expect(result).toBe("Tom &amp; Jerry");
    });

    it("should escape less-than character", () => {
      const result = escapeXml("<html>");
      expect(result).toBe("&lt;html&gt;");
    });

    it("should escape greater-than character", () => {
      const result = escapeXml("5 > 3");
      expect(result).toBe("5 &gt; 3");
    });

    it("should escape double quotes", () => {
      const result = escapeXml('He said "hello"');
      expect(result).toBe("He said &quot;hello&quot;");
    });

    it("should escape single quotes", () => {
      const result = escapeXml("It's working");
      expect(result).toBe("It&apos;s working");
    });
  });

  describe("multiple special characters", () => {
    it("should escape all special characters in a single string", () => {
      const result = escapeXml('<script>alert("XSS & <test>")</script>');
      expect(result).toBe("&lt;script&gt;alert(&quot;XSS &amp; &lt;test&gt;&quot;)&lt;/script&gt;");
    });

    it("should handle strings with all XML entities", () => {
      const result = escapeXml('&<>""\'""');
      expect(result).toBe("&amp;&lt;&gt;&quot;&quot;&apos;&quot;&quot;");
    });
  });

  describe("edge cases", () => {
    it("should return empty string unchanged", () => {
      const result = escapeXml("");
      expect(result).toBe("");
    });

    it("should handle strings with no special characters", () => {
      const result = escapeXml("Hello World 123");
      expect(result).toBe("Hello World 123");
    });

    it("should preserve whitespace", () => {
      const result = escapeXml("  spaced out  ");
      expect(result).toBe("  spaced out  ");
    });

    it("should handle newlines and tabs", () => {
      const result = escapeXml("line1\nline2\ttab");
      expect(result).toBe("line1\nline2\ttab");
    });
  });

  describe("security use cases", () => {
    it("should prevent XSS injection", () => {
      const maliciousInput = "<script>alert(document.cookie)</script>";
      const result = escapeXml(maliciousInput);
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });

    it("should escape attribute values", () => {
      const input = '<div class="my-class" title="<test>">';
      const result = escapeXml(input);
      expect(result).toBe("&lt;div class=&quot;my-class&quot; title=&quot;&lt;test&gt;&quot;&gt;");
    });
  });

  describe("real-world examples", () => {
    it("should handle JSON-like content", () => {
      const result = escapeXml('{"name": "value", "nested": {"key": "val"}}');
      expect(result).toBe(
        "{&quot;name&quot;: &quot;value&quot;, &quot;nested&quot;: {&quot;key&quot;: &quot;val&quot;}}",
      );
    });

    it("should handle Markdown code blocks", () => {
      const result = escapeXml("```\n<tag>content</tag>\n```");
      expect(result).toBe("```\n&lt;tag&gt;content&lt;/tag&gt;\n```");
    });
  });
});

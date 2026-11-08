import { describe, expect, it } from "vitest";

import { secretForms } from "./secret-forms.ts";

const SECRET = `p@ss "word" <&> it's! (ok)~`;

describe("secretForms", () => {
  it("lists the forms a page, a log or a submitted form can show a secret in", () => {
    const forms = secretForms(SECRET);
    expect(forms).toContain(SECRET);
    expect(forms).toContain(JSON.stringify(SECRET).slice(1, -1));
    expect(forms).toContain(encodeURIComponent(SECRET));
    expect(forms).toContain(new URLSearchParams([["", SECRET]]).toString().slice(1));
    expect(forms.some((form) => form.includes("&lt;&amp;&gt;"))).toBe(true);
  });

  it("leaves out forms too short to mask safely", () => {
    expect(secretForms("abc")).toEqual([]);
  });
});

const MIN_SECRET = 4;

function htmlEscaped(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}

export function secretForms(value: string): string[] {
  const forms = new Set([value, JSON.stringify(value).slice(1, -1), htmlEscaped(value)]);
  try {
    forms.add(encodeURIComponent(value));
    forms.add(encodeURIComponent(value).replace(/%20/gu, "+"));
    // A submitted form (application/x-www-form-urlencoded) also percent-encodes ! ' ( ) ~, which encodeURIComponent keeps.
    forms.add(new URLSearchParams([["", value]]).toString().slice(1));
  } catch {}
  return [...forms].filter((form) => form.length >= MIN_SECRET);
}

/**
 * Verbatim spans of the request that could fill a flag value or positional argument.
 * Jev only picks among options, so every value it can place in a command must come from here.
 * Tuned to over-find: an unused candidate costs a few tokens, a missing one can't be recovered.
 */
export function extractCandidates(request: string, tool: string): string[] {
  const found: string[] = [];
  const add = (value: string) => {
    const v = value.trim();
    if (v && v !== tool && !found.includes(v)) found.push(v);
  };

  // NFKC turns full-width letters and digits (１０件) into ASCII so the token pattern sees them.
  const text = request.normalize("NFKC");
  for (const m of text.matchAll(/「([^」]+)」|『([^』]+)』|"([^"]+)"|'([^']+)'|“([^”]+)”/g)) {
    add(m.slice(1).find((g) => g !== undefined)!);
  }
  for (const m of text.matchAll(/[A-Za-z0-9#][A-Za-z0-9._/:@#-]*/g)) {
    add(m[0].replace(/^#(?=\d)/, "").replace(/[.:]+$/, ""));
  }
  return found;
}

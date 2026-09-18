import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";

type Answer = { type: string; noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number> };

export type Reply = { answers: Record<string, Answer>; usage: { input_tokens: number } };

/** One System One call: evaluate every question against the same state. */
export type Ask = (state: Record<string, unknown>, questions: Questions) => Promise<Reply>;

export type Backend = { name: string; ask: Ask };

/** OpenRouter's Decisions endpoint takes the same state/questions body as TypeSafe's /v1/systemone. */
function openRouter(apiKey: string, model: string): Backend {
  const ask: Ask = async (state, questions) => {
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "nli",
      },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    return (await res.json()) as Reply;
  };
  return { name: `openrouter (${model})`, ask };
}

function typeSafe(model: string): Backend {
  const client = new TypeSafeClient({ defaultModel: model });
  const ask: Ask = async (state, questions) => (await client.systemOne({ state: state as never, questions })) as unknown as Reply;
  return { name: `typesafe (${model})`, ask };
}

/**
 * Load the gitignored `.env` at the package root, so keys work wherever `nli` is run from.
 * Variables already set in the shell take precedence over the file.
 */
export function loadDotEnv() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * NLI_BACKEND picks the provider explicitly; otherwise whichever key is set wins,
 * OpenRouter first. NLI_MODEL overrides the model name.
 */
export function createBackend(env = process.env): Backend {
  const backend = env.NLI_BACKEND ?? (env.OPENROUTER_API_KEY ? "openrouter" : env.TYPESAFE_API_KEY ? "typesafe" : undefined);
  switch (backend) {
    case "openrouter":
      if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
      return openRouter(env.OPENROUTER_API_KEY, env.NLI_MODEL ?? "~typesafe/jev-latest");
    case "typesafe":
      return typeSafe(env.NLI_MODEL ?? "jev-latest");
    case undefined:
      throw new Error("set OPENROUTER_API_KEY or TYPESAFE_API_KEY");
    default:
      throw new Error(`unknown NLI_BACKEND: ${backend} (openrouter | typesafe)`);
  }
}

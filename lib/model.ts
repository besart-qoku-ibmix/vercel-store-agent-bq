/**
 * Model access for both agents, through our own OpenAI-compatible provider
 * (not Vercel AI Gateway). The endpoint speaks Chat Completions, so we use
 * `provider.chat(...)`, not the default Responses API.
 *
 * Env (server only, names in .env.example):
 *   CUSTOM_AI_BASE_URL, CUSTOM_AI_API_KEY   endpoint + key
 *   CUSTOM_AI_MODEL_LUNA / CUSTOM_AI_MODEL_SOL   optional model id overrides
 *
 * Why a wrapper class: a `WorkflowAgent` model call is a durable step, so the
 * model crosses the workflow boundary. The stock provider model serializes its
 * config, including the Authorization header, which would put the API key in
 * the workflow event log. `CompanyChatModel` serializes only a role name and
 * builds the provider from env vars inside the step.
 *
 * Both models must support tool calling.
 * No `server-only` import: this is loaded inside the workflow bundle.
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

export type ModelRole = "shop" | "admin";

const MODEL_DEFAULTS: Record<ModelRole, { envVar: string; fallback: string }> = {
  // Fast and cheap: short shopping turns.
  shop: { envVar: "CUSTOM_AI_MODEL_LUNA", fallback: "gpt-6-luna" },
  // The admin agent plans multi-tool analysis and writes shell scripts.
  admin: { envVar: "CUSTOM_AI_MODEL_SOL", fallback: "gpt-6.1-sol" },
};

function resolveModelId(role: ModelRole): string {
  const { envVar, fallback } = MODEL_DEFAULTS[role];
  return process.env[envVar]?.trim() || fallback;
}

function createChatModel(role: ModelRole) {
  const baseURL = process.env.CUSTOM_AI_BASE_URL;
  const apiKey = process.env.CUSTOM_AI_API_KEY;
  if (!baseURL || !apiKey) {
    // Fixed text: nothing about the endpoint or key leaves the server.
    throw new Error("Model provider is not configured.");
  }
  return createOpenAI({ baseURL, apiKey }).chat(resolveModelId(role));
}

type Delegate = ReturnType<typeof createChatModel>;

class CompanyChatModel {
  readonly specificationVersion = "v4";
  readonly provider = "company-ai";
  private cached?: Delegate;

  static [WORKFLOW_SERIALIZE](model: CompanyChatModel) {
    return { role: model.role };
  }

  static [WORKFLOW_DESERIALIZE](data: { role: ModelRole }) {
    return new CompanyChatModel(data.role);
  }

  constructor(readonly role: ModelRole) {}

  /** Label only; the real id is resolved from env when the call is made. */
  get modelId() {
    return MODEL_DEFAULTS[this.role].fallback;
  }

  private get delegate(): Delegate {
    return (this.cached ??= createChatModel(this.role));
  }

  get supportedUrls() {
    return this.delegate.supportedUrls;
  }

  async doGenerate(options: Parameters<Delegate["doGenerate"]>[0]) {
    try {
      return await this.delegate.doGenerate(options);
    } catch (error) {
      logModelFailure(error);
      throw error;
    }
  }

  async doStream(options: Parameters<Delegate["doStream"]>[0]) {
    try {
      return await this.delegate.doStream(options);
    } catch (error) {
      logModelFailure(error);
      throw error;
    }
  }
}

/** Status code only: provider errors can carry the URL or request body. */
function logModelFailure(error: unknown) {
  const e = error as { name?: string; statusCode?: number; isRetryable?: boolean };
  console.error(
    `[model] call failed: ${e?.name ?? "Error"} status=${e?.statusCode ?? "none"} retryable=${e?.isRetryable ?? "n/a"}`,
  );
}

export function companyModel(role: ModelRole): LanguageModel {
  return new CompanyChatModel(role) as unknown as LanguageModel;
}

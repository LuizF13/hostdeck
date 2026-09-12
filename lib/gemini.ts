import type { HostingApp } from "@/lib/types";

export type InfrastructureInsight = {
  severity: "healthy" | "info" | "warning" | "critical";
  headline: string;
  summary: string;
  affectedApps: string[];
  changes: string[];
  recommendations: string[];
  model?: string;
};

type ProviderSummary = { provider: string; configured: boolean; error?: string };
type AnalysisInput = {
  mode?: "briefing" | "changes";
  apps: HostingApp[];
  providers: ProviderSummary[];
  events?: Array<Record<string, unknown>>;
};

export type RecoveryDecision = {
  shouldRecover: boolean;
  risk: "low" | "medium" | "high";
  appPurpose: string;
  reason: string;
  recommendedAction: "start" | "resume" | "none";
  notify: boolean;
  summary: string;
  model?: string;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

const insightSchema = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["healthy", "info", "warning", "critical"] },
    headline: { type: "string" },
    summary: { type: "string" },
    affectedApps: { type: "array", items: { type: "string" } },
    changes: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["severity", "headline", "summary", "affectedApps", "changes", "recommendations"],
};

const recoverySchema = {
  type: "object",
  properties: {
    shouldRecover: { type: "boolean" },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    appPurpose: { type: "string" },
    reason: { type: "string" },
    recommendedAction: { type: "string", enum: ["start", "resume", "none"] },
    notify: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["shouldRecover", "risk", "appPurpose", "reason", "recommendedAction", "notify", "summary"],
};

function compactApp(app: HostingApp) {
  return {
    id: app.id,
    provider: app.provider,
    name: app.name,
    status: app.status,
    url: app.url,
    cpu: app.cpu,
    ram: app.ram,
    storage: app.storage,
    network: app.network,
    uptime: app.uptime,
    language: app.language,
    cluster: app.cluster,
    latestDeploymentState: app.latestDeploymentState,
    updatedAt: app.updatedAt,
  };
}

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export async function analyzeInfrastructure(input: AnalysisInput): Promise<InfrastructureInsight> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const payload = {
    mode: input.mode || "briefing",
    providers: input.providers,
    apps: input.apps.map(compactApp),
    events: input.events || [],
    generatedAt: new Date().toISOString(),
  };
  const prompt = `Você é o analista de infraestrutura do HostDeck. Analise o snapshot abaixo e responda em português do Brasil.\n\nRegras:\n- identifique indisponibilidade, pausa inesperada, erro de provedor, build/deploy em andamento e mudanças importantes;\n- não invente causa raiz; sem evidência, recomende confirmar nos logs;\n- use recomendações concretas e curtas;\n- se tudo estiver normal, use severity \"healthy\";\n- no modo \"changes\", priorize os eventos detectados e explique o impacto.\n\nSnapshot JSON:\n${JSON.stringify(payload)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: insightSchema },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json() as GeminiResponse;
    if (!response.ok) throw new Error(json.error?.message || `Gemini HTTP ${response.status}`);
    const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!text) throw new Error("O Gemini não retornou uma análise.");
    try {
      return { ...(JSON.parse(text) as InfrastructureInsight), model };
    } catch {
      throw new Error("O Gemini retornou uma resposta em formato inválido.");
    }
  } finally {
    clearTimeout(timer);
  }
}


export async function analyzeRecovery(input: {
  app: HostingApp;
  previousStatus?: string | null;
  currentStatus?: string | null;
  providers?: ProviderSummary[];
  event?: Record<string, unknown>;
}): Promise<RecoveryDecision> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const payload = {
    app: compactApp(input.app),
    availableActions: input.app.actions,
    previousStatus: input.previousStatus || null,
    currentStatus: input.currentStatus || input.app.status,
    providers: input.providers || [],
    event: input.event || {},
    generatedAt: new Date().toISOString(),
  };
  const prompt = `Você é o mecanismo de decisão de recuperação do HostDeck. Analise uma única aplicação que sofreu mudança de estado e decida se uma tentativa NÃO destrutiva de recuperação automática é apropriada.

Regras obrigatórias:
- responda em português do Brasil;
- considere o que a aplicação provavelmente faz usando nome, descrição, URL, linguagem, provider e metadados disponíveis;
- só autorize recuperação quando a aplicação estava ONLINE imediatamente antes e passou inesperadamente para OFFLINE ou ERROR;
- nunca autorize se o estado atual for PAUSED, BUILDING ou UNKNOWN;
- nunca suponha que uma pausa foi acidental;
- use apenas ações realmente presentes em availableActions;
- prefira "start" para processos desligados e "resume" apenas quando essa ação for suportada e o estado não indicar pausa deliberada;
- se houver incerteza relevante, risco alto, mudança de deployment em andamento ou evidência insuficiente, shouldRecover=false;
- não invente causa raiz;
- não peça nem exponha credenciais;
- "notify" deve ser true para falha relevante ou recuperação executada; false para mudança sem impacto.

Contexto JSON:
${JSON.stringify(payload)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 700,
          responseMimeType: "application/json",
          responseSchema: recoverySchema,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json() as GeminiResponse;
    if (!response.ok) throw new Error(json.error?.message || `Gemini HTTP ${response.status}`);
    const raw = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!raw) throw new Error("O Gemini não retornou uma decisão de recuperação.");
    try {
      return { ...(JSON.parse(raw) as RecoveryDecision), model };
    } catch {
      throw new Error("O Gemini retornou uma decisão de recuperação inválida.");
    }
  } finally {
    clearTimeout(timer);
  }
}


type ChatMessage = { role: "user" | "assistant"; content: string };

export async function chatWithGemini(input: {
  messages: ChatMessage[];
  apps: HostingApp[];
  providers: ProviderSummary[];
  alerts?: Array<Record<string, unknown>>;
}): Promise<{ message: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const snapshot = {
    providers: input.providers,
    apps: input.apps.map(compactApp),
    recentAlerts: (input.alerts || []).slice(0, 12),
    generatedAt: new Date().toISOString(),
  };
  const system = `Você é o HostDeck Intelligence, um copiloto SRE/DevOps em português do Brasil. Você conhece apenas o snapshot fornecido e a conversa. Seja objetivo, técnico e útil. Nunca invente causa raiz, credencial, log ou métrica. Quando houver incerteza, diga exatamente o que precisa ser verificado. Não execute ações destrutivas e não afirme que reiniciou/parou algo. Ajude a diagnosticar incidentes, comparar aplicações, explicar alertas e sugerir próximos passos.\n\nSNAPSHOT ATUAL:\n${JSON.stringify(snapshot)}`;
  const contents = [
    { role: "user", parts: [{ text: system }] },
    { role: "model", parts: [{ text: "Entendido. Vou analisar somente os dados do HostDeck e deixar explícito quando algo precisar ser confirmado em logs ou no provedor." }] },
    ...input.messages.slice(-20).map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents, generationConfig: { temperature: 0.35, maxOutputTokens: 1600 } }),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json() as GeminiResponse;
    if (!response.ok) throw new Error(json.error?.message || `Gemini HTTP ${response.status}`);
    const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!text) throw new Error("O Gemini não retornou uma resposta.");
    return { message: text, model };
  } finally {
    clearTimeout(timer);
  }
}


export async function streamChatWithGemini(input: {
  messages: ChatMessage[];
  apps: HostingApp[];
  providers: ProviderSummary[];
  alerts?: Array<Record<string, unknown>>;
}): Promise<{ response: Response; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const snapshot = {
    providers: input.providers,
    apps: input.apps.map(compactApp),
    recentAlerts: (input.alerts || []).slice(0, 12),
    generatedAt: new Date().toISOString(),
  };
  const system = `Você é o HostDeck Intelligence, um copiloto SRE/DevOps em português do Brasil. Você conhece apenas o snapshot fornecido e a conversa. Seja objetivo, técnico e útil. Nunca invente causa raiz, credencial, log ou métrica. Quando houver incerteza, diga exatamente o que precisa ser verificado. Não execute ações destrutivas e não afirme que reiniciou/parou algo. Ajude a diagnosticar incidentes, comparar aplicações, explicar alertas e sugerir próximos passos.

SNAPSHOT ATUAL:
${JSON.stringify(snapshot)}`;
  const contents = [
    { role: "user", parts: [{ text: system }] },
    { role: "model", parts: [{ text: "Entendido. Vou analisar somente os dados do HostDeck e deixar explícito quando algo precisar ser confirmado em logs ou no provedor." }] },
    ...input.messages.slice(-20).map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
  ];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.35, maxOutputTokens: 1800 } }),
    cache: "no-store",
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try { message = (JSON.parse(raw) as GeminiResponse).error?.message || raw; } catch {}
    throw new Error(message || `Gemini HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("O Gemini não abriu o stream de resposta.");
  return { response, model };
}

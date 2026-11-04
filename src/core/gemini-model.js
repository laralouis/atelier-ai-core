
/**
 * ATELIER AI – Gemini Cloud Model
 * Version 0.1
 *
 * Spiegel der LocalModel-Schnittstelle, aber gegen die Google-Gemini-
 * REST-API. Kein WebGPU, kein KV-Cache-Risiko – dafür geht jede Anfrage
 * an Google-Server. Datenschutz-Hinweis wird in der UI gezeigt.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const STORAGE_KEY = "atelier_gemini_key";

const AVAILABLE_MODELS = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash (empfohlen)",
    note: "Neuestes kostenloses Modell, sehr gute Qualität"
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    note: "Stabil, schnell, zuverlässig"
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    note: "Am schnellsten, etwas einfacher"
  }
];

const MAX_OUTPUT_TOKENS = 1500;
const MAX_OUTPUT_TOKENS_QUIZ = 2000;
const MAX_OUTPUT_TOKENS_REVIEW = 3000;

function safeText(value) {
  return String(value || "").trim();
}

function getStoredKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeKey(key) {
  try {
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function prepareContext(materials = []) {
  const valid = (materials || []).filter(
    item => item && safeText(item.content)
  );
  if (!valid.length) return "";

  return valid
    .map(item => {
      const title = safeText(item.title) || "Material";
      return `${title}:\n${safeText(item.content)}`;
    })
    .join("\n\n");
}

function buildUserMessage(request, context) {
  const isQuiz = request.metadata?.mode === "quiz";
  const input = safeText(request.input);

  if (isQuiz) {
    return `AUFGABE:\n${input}` +
      (context ? `\n\nARBEITSMATERIAL:\n${context}` : "") +
      `\n\nAntworte ausschließlich im vorgegebenen Format. Keine Einleitung, kein Markdown.`;
  }

  return (context ? `MATERIALIEN (nur als Hintergrundwissen):\n${context}\n\n` : "") +
    `FRAGE:\n${input}`;
}

function describeHttpError(status, errorText) {
  if (status === 400) {
    return "Anfrage wurde von Google abgelehnt. Vielleicht ist das Modell für deinen Account nicht freigeschaltet.";
  }
  if (status === 401 || status === 403) {
    return "API-Key wurde von Google abgelehnt. Prüfe, ob der Key korrekt ist und ob 'Generative Language API' im Projekt aktiviert ist.";
  }
  if (status === 429) {
    return "Du hast das kostenlose Gemini-Kontingent für dieses Zeitfenster aufgebraucht. Bitte ca. eine Minute warten oder morgen weitermachen.";
  }
  if (status >= 500) {
    return "Google-Server antwortet gerade nicht. Bitte kurz später erneut versuchen.";
  }
  return `Google-Fehler (Code ${status}).` + (errorText ? " " + errorText.slice(0, 200) : "");
}

export class GeminiModel {
  constructor() {
    this.apiKey = getStoredKey();
    this.modelId = null;
    this.lastModelId = null;
    this.ready = false;
    this.loading = false;
    this.generating = false;
    this.unloading = false;
    this.status = this.apiKey ? "not_loaded" : "no_key";
    this.error = null;
    this.progress = 0;
    this.generationCount = 0;
  }

  setApiKey(key) {
    const clean = safeText(key);
    this.apiKey = clean;
    storeKey(clean);
    this.ready = false;
    this.modelId = null;
    this.status = clean ? "not_loaded" : "no_key";
    this.error = null;
    this.progress = 0;
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  getStatus() {
    return {
      ready: this.ready,
      loading: this.loading,
      generating: this.generating,
      unloading: this.unloading,
      model: this.modelId,
      progress: this.progress,
      status: this.status,
      error: this.error,
      generationCount: this.generationCount,
      hasKey: this.hasApiKey()
    };
  }

  async checkSupport() {
    if (!this.apiKey) {
      return {
        supported: false,
        reason: "Noch kein Gemini API-Key gespeichert."
      };
    }
    return {
      supported: true,
      reason: "Gemini-Anbindung bereit (API-Key gespeichert)."
    };
  }

  async getAvailableModels() {
    return AVAILABLE_MODELS.map(model => ({
      id: model.id,
      name: model.name,
      vram: null,
      note: model.note
    }));
  }

  async load(modelId, onProgress = () => {}) {
    if (!this.apiKey) {
      throw new Error(
        "Bitte zuerst einen Gemini API-Key eintragen und speichern."
      );
    }

    if (!modelId) {
      throw new Error("Bitte zuerst ein Gemini-Modell auswählen.");
    }

    this.loading = true;
    this.progress = 10;
    this.status = "loading";
    this.error = null;

    try {
      onProgress({
        progress: 30,
        text: "Verbindung zu Google wird getestet ..."
      });

      const testResponse = await fetch(
        `${GEMINI_API_BASE}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: "ping" }] }
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 5
            }
          })
        }
      );

      if (!testResponse.ok) {
        const errorText = await testResponse.text().catch(() => "");
        throw new Error(describeHttpError(testResponse.status, errorText));
      }

      onProgress({ progress: 100, text: "Gemini verbunden." });

      this.modelId = modelId;
      this.lastModelId = modelId;
      this.ready = true;
      this.status = "ready";
      this.progress = 100;
      this.generationCount = 0;

      return this.getStatus();

    } catch (error) {
      this.ready = false;
      this.modelId = null;
      this.status = "error";
      this.error = error?.message || String(error);
      throw new Error(this.error);

    } finally {
      this.loading = false;
    }
  }

  async unload() {
    this.ready = false;
    this.modelId = null;
    this.status = this.apiKey ? "not_loaded" : "no_key";
    this.error = null;
    this.progress = 0;
    return this.getStatus();
  }

  async reload(onProgress = () => {}) {
    if (!this.lastModelId) {
      throw new Error(
        "Kein Gemini-Modell zum Neuladen vorgemerkt."
      );
    }
    return this.load(this.lastModelId, onProgress);
  }

  async softResetChat() {
    this.generationCount = 0;
  }

  async generate(request) {
    if (!this.ready || !this.modelId) {
      throw new Error("Es ist kein Gemini-Modell verbunden.");
    }

    if (!this.apiKey) {
      throw new Error("Kein Gemini API-Key gespeichert.");
    }

    if (!request || !safeText(request.input)) {
      throw new Error("Die Frage ist leer.");
    }

    this.generating = true;

    try {
      const isQuiz = request.metadata?.mode === "quiz";
      const longForm = request.metadata?.longForm === true;

      const context = prepareContext(request.context || []);
      const userText = buildUserMessage(request, context);

      const history = Array.isArray(request.history) ? request.history : [];
      const contents = [];

      for (const entry of history.slice(-6)) {
        if (!entry || typeof entry.content !== "string") continue;
        const text = entry.content.slice(0, 2000);
        if (!text.trim()) continue;
        contents.push({
          role: entry.role === "assistant" ? "model" : "user",
          parts: [{ text }]
        });
      }

      contents.push({
        role: "user",
        parts: [{ text: userText }]
      });

      const maxTokens = isQuiz
        ? MAX_OUTPUT_TOKENS_QUIZ
        : (longForm ? MAX_OUTPUT_TOKENS_REVIEW : MAX_OUTPUT_TOKENS);

      const body = {
        contents,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens
        }
      };

      const systemText = safeText(request.system);
      if (systemText) {
        body.systemInstruction = {
          parts: [{ text: systemText }]
        };
      }

      const response = await fetch(
        `${GEMINI_API_BASE}/${encodeURIComponent(this.modelId)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const friendly = describeHttpError(response.status, errorText);
        this.error = friendly;
        throw new Error(friendly);
      }

      const data = await response.json();
      const candidate = data?.candidates?.[0];
      const answer = safeText(
        candidate?.content?.parts?.map(part => part?.text).filter(Boolean).join("") || ""
      );

      if (!answer) {
        const reason = candidate?.finishReason;
        if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
          throw new Error(
            `Google hat die Antwort blockiert (Grund: ${reason}). Bitte die Frage anders formulieren.`
          );
        }
        throw new Error("Gemini hat keine Antwort geliefert.");
      }

      this.generationCount += 1;

      return {
        status: "success",
        provider: "Gemini",
        model: this.modelId,
        answer,
        usage: data?.usageMetadata || null,
        partial: candidate?.finishReason === "MAX_TOKENS"
      };

    } catch (error) {
      this.error = error?.message || String(error);
      throw error;

    } finally {
      this.generating = false;
    }
  }
}

export const geminiModel = new GeminiModel();

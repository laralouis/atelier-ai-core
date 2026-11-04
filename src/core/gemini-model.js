
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

// Fallback-Liste – aktive Free-Tier-Modelle (Stand November 2026).
// Google hat gemini-2.0-flash am 1. Juni 2026 abgeschaltet und sperrt
// gemini-2.5-flash für neu angelegte API-Keys. Deshalb liegen diese
// Namen NICHT mehr im Fallback; sie werden auch aktiv ausgeblendet.
const AVAILABLE_MODELS = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (empfohlen)",
    note: "Neuestes kostenloses Modell, beste Qualität"
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    note: "Stabil, schnell"
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    note: "Leichtgewichtig, sehr schnell"
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    note: "Älter, weiter kostenlos"
  }
];

// Bevorzugte Sortierreihenfolge im Dropdown. Niedriger = weiter oben.
function rankModel(id) {
  if (/^gemini-3\.8-flash/.test(id)) return 1;
  if (/^gemini-3\.6-flash/.test(id)) return 2;
  if (/^gemini-3\.5-flash-lite/.test(id)) return 3;
  if (/^gemini-3\.1-flash-lite/.test(id)) return 4;
  if (/^gemini-3\./.test(id)) return 5;
  if (/pro/.test(id)) return 6;
  return 9;
}

// Modelle rausfiltern, die für den Chat-Flow ungeeignet sind (Embeddings,
// Bild-/Vision-Tuning, experimentelle / "latest"-Platzhalter) oder von
// Google für neue Free-Tier-Keys gesperrt bzw. komplett eingestellt sind.
function isUsableModel(id) {
  if (!id) return false;
  if (/embedding|embed|aqa|image-generation|imagen|tts|vision-tuning|tuning/i.test(id)) return false;
  if (/-exp(-|$)|preview|latest/i.test(id)) return false;
  // Deprecated bzw. für neue Keys gesperrt: 2.0er und 2.5-flash raus.
  if (/^gemini-2\.0-flash/i.test(id)) return false;
  if (/^gemini-2\.5-flash$/i.test(id)) return false;
  return true;
}

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
  if (status === 404) {
    if (/no longer available to new users/i.test(errorText || "")) {
      return "Dieses Gemini-Modell ist für neu angelegte API-Keys gesperrt. Bitte im Dropdown stattdessen 'gemini-3.8-flash' auswählen und neu verbinden.";
    }
    return "Google kennt dieses Modell nicht (mehr). Bitte 'gemini-3.8-flash' aus der Liste wählen – das ist aktuell das empfohlene kostenlose Modell.";
  }
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
    const detail = errorText ? " Details: " + errorText.replace(/\s+/g, " ").slice(0, 220) : "";
    return `Google-Server antwortet gerade nicht (Code ${status}).${detail}`;
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
    const fallback = AVAILABLE_MODELS.map(model => ({
      id: model.id,
      name: model.name,
      vram: null,
      note: model.note
    }));

    if (!this.apiKey) return fallback;

    let fetched = [];
    try {
      const response = await fetch(
        `${GEMINI_API_BASE}?key=${encodeURIComponent(this.apiKey)}`,
        { method: "GET" }
      );

      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data?.models) ? data.models : [];

        fetched = list
          .filter(entry =>
            Array.isArray(entry?.supportedGenerationMethods) &&
            entry.supportedGenerationMethods.includes("generateContent")
          )
          .map(entry => ({
            id: safeText(entry.name).replace(/^models\//, ""),
            name: safeText(entry.displayName) || safeText(entry.name).replace(/^models\//, ""),
            note: safeText(entry.description).split(/\.\s/)[0],
            vram: null
          }))
          .filter(entry => isUsableModel(entry.id));
      }
    } catch {
      /* Netzfehler → wir bleiben bei Fallback allein */
    }

    // Fallback-Modelle (gemini-2.0-flash etc.) kommen IMMER ins Dropdown,
    // auch wenn Google sie dem Account nicht aktiv listet. Ohne diesen
    // Merge hatte der User bei neu angelegten Keys nur die 2.5-Varianten
    // zur Auswahl – und genau die sind serverseitig gesperrt.
    const merged = [];
    const seen = new Set();
    for (const m of fallback) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
    for (const m of fetched) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }

    return merged.sort((a, b) => {
      const diff = rankModel(a.id) - rankModel(b.id);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
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

    // Auto-Fallback für Google-seitig gesperrte Namen. Alte Dropdown-Werte
    // aus einem gecachten Browser-State sollen die Verbindung nicht brechen.
    const blockedAliases = {
      "gemini-2.5-flash": "gemini-3.8-flash",
      "gemini-2.0-flash": "gemini-3.8-flash",
      "gemini-2.0-flash-lite": "gemini-3.5-flash-lite"
    };
    const requested = modelId;
    if (blockedAliases[modelId]) {
      modelId = blockedAliases[modelId];
      onProgress({
        progress: 15,
        text: `${requested} ist für neue API-Keys gesperrt – weiche auf ${modelId} aus ...`
      });
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

      // Gemini 3.x hat Default-Thinking aktiv. Ohne thinkingBudget: 0 reicht
      // maxOutputTokens: 5 nicht fürs Denken und Google wirft dann 5xx.
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
              maxOutputTokens: 50,
              thinkingConfig: { thinkingBudget: 0 }
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
          maxOutputTokens: maxTokens,
          // Thinking aus: Modell soll direkt antworten, nicht im Hintergrund
          // "nachdenken". Spart Tokens und vermeidet 5xx auf 3.x-Modellen.
          thinkingConfig: { thinkingBudget: 0 }
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

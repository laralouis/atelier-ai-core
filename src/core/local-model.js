
/**
 * ATELIER AI – Local AI Model
 * Version 0.5
 *
 * Serielle Verwaltung aller WebLLM-Modellzugriffe.
 */

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.87";
// Alle Zeichen-/Token-Limits bewusst klein gehalten: iPad-Metal OOM-t
// schnell, wenn Prompt + KV-Cache + Output zusammen zu groß werden.
// Lokale Materialien bekommen etwas mehr Platz als externe Quellen,
// aber alles so klein wie möglich – der iPad GPU-Adapter verliert
// sonst zuverlässig den Zustand und kann nicht neu geladen werden.
const MAX_CONTEXT_CHARS = 1300;
const MAX_LOCAL_CHARS = 900;
const MAX_EXTERNAL_CHARS = 300;
const MAX_OUTPUT_TOKENS = 350;
const MAX_OUTPUT_TOKENS_QUIZ = 280;
const MAX_OUTPUT_TOKENS_REVIEW = 680;
const MAX_HISTORY_MESSAGES = 2;
const MAX_HISTORY_CHARS_PER_MESSAGE = 400;
const MAX_HISTORY_CHARS_TOTAL = 800;

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  const normalized = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = recent[i];
    if (!entry || typeof entry !== "object") continue;

    const role = entry.role === "assistant" ? "assistant" : "user";
    const content = safeText(entry.content);

    if (!content) continue;

    const trimmed = content.slice(0, MAX_HISTORY_CHARS_PER_MESSAGE);

    if (totalChars + trimmed.length > MAX_HISTORY_CHARS_TOTAL) break;

    totalChars += trimmed.length;
    normalized.unshift({ role, content: trimmed });
  }

  return normalized;
}

function safeText(value) {
  return String(value || "").trim();
}

function isExternalMaterial(item) {
  const title = safeText(item.title).toLowerCase();

  return (
    title.includes("[externe quelle]") ||
    title.includes("[external source]") ||
    title.includes("[fuente externa]")
  );
}

const CONTEXT_LABELS = {
  de: {
    material: "Material",
    externalSource: "Externe Quelle",
    classMaterials: "UNTERRICHTSMATERIALIEN",
    externalResearch: "EXTERNE RECHERCHE"
  },
  en: {
    material: "Material",
    externalSource: "External source",
    classMaterials: "CLASS MATERIALS",
    externalResearch: "EXTERNAL RESEARCH"
  },
  es: {
    material: "Material",
    externalSource: "Fuente externa",
    classMaterials: "MATERIALES DE CLASE",
    externalResearch: "INVESTIGACIÓN EXTERNA"
  }
};

const QUIZ_LABELS = {
  de: {
    task: "AUFGABE",
    reference:
      "ARBEITSMATERIAL (eigene Unterrichtsmaterialien – jede Übung MUSS auf einem konkreten Fakt aus genau diesen Materialien basieren; keine erfundenen Inhalte)",
    outro:
      "Nutze die ARBEITSMATERIALIEN als primäre Faktenquelle. Antworte ausschließlich im vorgegebenen Textformat. Keine Einleitung, kein zusätzlicher Text."
  },
  en: {
    task: "TASK",
    reference:
      "WORKING MATERIAL (the student's own class materials – every exercise MUST be based on a concrete fact from exactly these materials; no invented content)",
    outro:
      "Use the WORKING MATERIAL as your primary source of facts. Reply strictly in the given text format. No preamble, no extra text."
  },
  es: {
    task: "TAREA",
    reference:
      "MATERIAL DE TRABAJO (materiales de clase propios de la alumna – cada ejercicio DEBE basarse en un hecho concreto de exactamente estos materiales; sin contenido inventado)",
    outro:
      "Utiliza el MATERIAL DE TRABAJO como fuente principal de hechos. Responde únicamente en el formato de texto indicado. Sin introducción ni texto adicional."
  }
};

const TUTOR_LABELS = {
  de: {
    materials: "MATERIALIEN (nur als Hintergrundwissen nutzen)",
    question: "FRAGE DES SCHÜLERS",
    outro:
      "Beantworte genau diese Frage, fachlich korrekt und verständlich."
  },
  en: {
    materials: "MATERIALS (use only as background knowledge)",
    question: "STUDENT'S QUESTION",
    outro:
      "Answer exactly this question, accurately and understandably."
  },
  es: {
    materials: "MATERIALES (úsalos solo como conocimiento de fondo)",
    question: "PREGUNTA DEL ALUMNO",
    outro:
      "Responde exactamente a esta pregunta, con precisión y de forma comprensible."
  }
};

const TUTOR_SYSTEM_SUFFIX = {
  de: `
Beantworte die zuletzt gestellte Frage des Schülers direkt und konkret.
Weiche nicht ins allgemeine Erklären aus, wenn die Frage spezifisch ist.
Nutze bereitgestellte Materialien vorrangig, erfinde keine Quellen.`,
  en: `
Answer the student's latest question directly and concretely.
Do not drift into general explanations when the question is specific.
Prefer the materials provided; do not invent sources.`,
  es: `
Responde a la última pregunta del alumno de forma directa y concreta.
No te desvíes hacia explicaciones generales si la pregunta es específica.
Da prioridad a los materiales proporcionados; no inventes fuentes.`
};

function pickLang(language) {
  if (language === "en" || language === "es") return language;
  return "de";
}

function prepareContext(materials = [], language = "de") {
  const labels = CONTEXT_LABELS[pickLang(language)];

  const validMaterials = materials.filter(
    item => item && safeText(item.content)
  );

  const localMaterials = validMaterials.filter(
    item => !isExternalMaterial(item)
  );

  const externalMaterials = validMaterials.filter(
    isExternalMaterial
  );

  let localText = "";
  let externalText = "";

  for (const item of localMaterials) {
    if (localText.length >= MAX_LOCAL_CHARS) break;

    const block =
      `${labels.material}: ${safeText(item.title)}\n` +
      `${safeText(item.content)}\n\n`;

    localText += block.slice(
      0,
      MAX_LOCAL_CHARS - localText.length
    );
  }

  for (const item of externalMaterials) {
    if (externalText.length >= MAX_EXTERNAL_CHARS) break;

    const block =
      `${labels.externalSource}: ${safeText(item.title)}\n` +
      `${safeText(item.content)}\n\n`;

    externalText += block.slice(
      0,
      MAX_EXTERNAL_CHARS - externalText.length
    );
  }

  let context = "";

  if (localText.trim()) {
    context += `${labels.classMaterials}:\n` + localText.trim();
  }

  if (externalText.trim()) {
    context += `\n\n${labels.externalResearch}:\n` + externalText.trim();
  }

  return context.slice(0, MAX_CONTEXT_CHARS);
}

function getFriendlyError(error) {
  const message = String(
    error?.message || error || "Unbekannter Fehler"
  );

  console.error("ATELIER AI – Originalfehler:", error);

  if (/map async was not successful|out of memory|OOM/i.test(message)) {
    return (
      "Der Grafikspeicher des Geräts ist voll. Bitte das Gespräch " +
      "mit „Verlauf löschen\" zurücksetzen oder ein kleineres Modell wählen."
    );
  }

  if (/already been disposed|disposed/i.test(message)) {
    return (
      "Das KI-Modell hat seinen GPU-Zustand verloren. " +
      "Bitte unter „KI-Modell\" das Modell einmal entladen und neu laden."
    );
  }

  if (/kompatibler GPU-Adapter|no adapter|requestAdapter|GPUAdapter/i.test(message)) {
    return (
      "Der GPU-Zugriff ist gerade blockiert. " +
      "Bitte den Browser-Tab komplett schließen und die Seite neu öffnen – " +
      "danach lässt sich das Modell wieder laden."
    );
  }

  if (/failed writing data|quota|QuotaExceeded|NotAllowedError|storage/i.test(message)) {
    return (
      "Der Browser verweigert den nötigen Speicherplatz für das Modell. " +
      "Bitte diese Seite über \"Zum Home-Bildschirm\" auf dem iPad speichern " +
      "und von dort öffnen – Safari gibt installierten Apps vollen Speicher-Zugriff."
    );
  }

  return message;
}

export class LocalModel {
  constructor() {
    this.engine = null;
    this.webllm = null;
    this.modelId = null;

    // Bleibt auch nach einem Fehler erhalten, damit automatisches
    // Neuladen mit derselben Modell-ID möglich ist.
    this.lastModelId = null;

    this.loading = false;
    this.generating = false;
    this.unloading = false;

    this.ready = false;
    this.progress = 0;
    this.status = "not_loaded";
    this.error = null;

    // Zählt erfolgreiche Generierungen. Dient dazu, zwischen
    // Batches erkennen zu können, ob der Engine-Zustand bereits
    // „benutzt" ist und zur Sicherheit frisch geladen werden sollte.
    this.generationCount = 0;

    this.requestQueue = Promise.resolve();
  }

  /**
   * Weiches Zurücksetzen zwischen Batches.
   *
   * engine.resetChat() wird in WebLLM 0.2.87 nicht aufgerufen, weil es
   * zu „already disposed"-Fehlern bei der nächsten Anfrage führt. Da
   * chat.completions.create() die komplette Message-History pro Anfrage
   * übergeben bekommt, ist der Engine zwischen Anfragen ohnehin
   * zustandslos genug – wir müssen hier nichts zurücksetzen.
   */
  async softResetChat() {
    return this.runExclusive(async () => {
      this.generationCount = 0;
    });
  }

  /**
   * Lädt das zuletzt verwendete Modell erneut.
   * Wird nach einem GPU-Verlust automatisch aufgerufen.
   */
  async reload(onProgress = () => {}) {
    if (!this.lastModelId) {
      throw new Error(
        "Kein Modell zum Neuladen vorgemerkt. Bitte zuerst ein Modell auswählen."
      );
    }

    // Alten Engine-Zustand sauber zurücksetzen, bevor neu geladen wird.
    this.engine = null;
    this.modelId = null;
    this.ready = false;

    return this.load(this.lastModelId, onProgress);
  }

  /**
   * Alle Modellzugriffe werden nacheinander ausgeführt.
   */
  async runExclusive(task) {
    const current = this.requestQueue.then(task, task);

    this.requestQueue = current.then(
      () => undefined,
      () => undefined
    );

    return current;
  }

  async checkSupport() {
    if (!navigator.gpu) {
      return {
        supported: false,
        reason: "WebGPU wird in diesem Browser nicht unterstützt."
      };
    }

    // Nach einem Dispose gibt iPadOS Safari den WebGPU-Adapter oft erst
    // nach mehreren Sekunden wieder frei – Metal-Ressourcen werden
    // asynchron freigegeben. Wir probieren über ~13 Sekunden hinweg mit
    // zunehmender Pause und wechselnden PowerPreferences.
    const attempts = [
      { opts: { powerPreference: "high-performance" }, wait: 0 },
      { opts: { powerPreference: "low-power" }, wait: 600 },
      { opts: {}, wait: 1200 },
      { opts: { powerPreference: "high-performance" }, wait: 2000 },
      { opts: { powerPreference: "low-power" }, wait: 3000 },
      { opts: {}, wait: 4500 }
    ];

    let lastError = null;

    for (let i = 0; i < attempts.length; i++) {
      const { opts, wait } = attempts[i];

      if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait));
      }

      try {
        const adapter = await navigator.gpu.requestAdapter(opts);

        if (adapter) {
          return {
            supported: true,
            reason: "WebGPU ist verfügbar."
          };
        }
      } catch (error) {
        lastError = error;
      }
    }

    return {
      supported: false,
      reason:
        "Kein kompatibler GPU-Adapter verfügbar. " +
        "Bitte den Browser-Tab einmal komplett schließen und die Seite " +
        "neu öffnen – Safari gibt den GPU-Zugriff nach dem Entladen " +
        "manchmal erst nach einem Tab-Neustart wieder frei." +
        (lastError?.message ? ` (${lastError.message})` : "")
    };
  }

  async loadWebLLM() {
    if (!this.webllm) {
      this.webllm = await import(WEBLLM_URL);
    }

    return this.webllm;
  }


  async getAvailableModels() {
    const webllm = await this.loadWebLLM();

    const models = webllm.prebuiltAppConfig.model_list || [];

    return models
      .map(model => ({
        id: model.model_id,
        name: model.model_id,
        vram: model.vram_required_MB
      }))
      .sort((a, b) => {
        const vramA = a.vram ?? Number.MAX_SAFE_INTEGER;
        const vramB = b.vram ?? Number.MAX_SAFE_INTEGER;
        if (vramA !== vramB) return vramA - vramB;
        return a.id.localeCompare(b.id);
      });
  }

  /**
   * Laden läuft jetzt ebenfalls innerhalb der Warteschlange.
   */
  async load(modelId, onProgress = () => {}) {
    return this.runExclusive(async () => {
      if (!modelId) {
        throw new Error("Bitte zuerst ein Modell auswählen.");
      }

      if (this.ready && this.modelId === modelId && this.engine) {
        return this.getStatus();
      }

      this.loading = true;
      this.ready = false;
      this.error = null;
      this.status = "checking";
      this.progress = 0;

      const oldEngine = this.engine;

      this.engine = null;
      this.modelId = null;
      this.lastModelId = modelId;

      try {
        // Ein eventuell vorhandenes Modell zuerst sauber entladen.
        // Falls das Modell bereits disposed ist, schlägt unload() fehl –
        // das darf uns nicht am Neuladen hindern.
        if (oldEngine) {
          try {
            await oldEngine.unload();
          } catch (unloadError) {
            console.warn(
              "ATELIER AI: Entladen des alten Modells fehlgeschlagen (ignoriert):",
              unloadError
            );
          }
        }

        // Deutlich länger warten, damit iPadOS Safari den GPU-Adapter
        // nach einem Dispose-Zustand sauber wieder freigeben kann.
        // Metal gibt Ressourcen asynchron frei – 600ms sind zu knapp,
        // 2 Sekunden sind empirisch die Untergrenze, bei der der neue
        // requestAdapter() auf dem iPad wieder zuverlässig funktioniert.
        await new Promise(resolve => setTimeout(resolve, 2000));

        const support = await this.checkSupport();

        if (!support.supported) {
          throw new Error(support.reason);
        }

        const webllm = await this.loadWebLLM();

        const available = webllm.prebuiltAppConfig.model_list
          .some(model => model.model_id === modelId);

        if (!available) {
          throw new Error(
            "Dieses Modell ist in WebLLM nicht registriert."
          );
        }

        this.status = "loading";

        const engine = await webllm.CreateMLCEngine(
          modelId,
          {
            initProgressCallback: report => {
              this.progress = Math.round(
                (report.progress || 0) * 100
              );

              this.status = "loading";

              onProgress({
                progress: this.progress,
                text: report.text || "Modell wird geladen."
              });
            }
          }
        );

        this.engine = engine;
        this.modelId = modelId;
        this.ready = true;
        this.status = "ready";
        this.progress = 100;
        this.generationCount = 0;

        return this.getStatus();

      } catch (error) {
        this.engine = null;
        this.modelId = null;
        this.ready = false;
        this.status = "error";
        this.error = getFriendlyError(error);

        throw new Error(this.error);

      } finally {
        this.loading = false;
      }
    });
  }

  /**
   * Generierung und Modellwechsel können nicht mehr kollidieren.
   */
  async generate(request) {
    return this.runExclusive(async () => {
      if (!this.ready || !this.engine) {
        throw new Error(
          "Es ist kein verfügbares lokales KI-Modell geladen."
        );
      }

      if (!request || !safeText(request.input)) {
        throw new Error("Die Frage ist leer.");
      }

      const engine = this.engine;
      const modelId = this.modelId;

      this.generating = true;

      try {
        const language = pickLang(request.metadata?.language);
        const context = prepareContext(request.context || [], language);

        const isQuiz = request.metadata?.mode === "quiz";
        const quizL = QUIZ_LABELS[language];
        const tutorL = TUTOR_LABELS[language];

        const systemPrompt = isQuiz
          ? safeText(request.system)
          : `${safeText(request.system)}${TUTOR_SYSTEM_SUFFIX[language]}`;

        const userMessage = isQuiz
          ? `${quizL.task}:\n${safeText(request.input)}${context ? `\n\n${quizL.reference}:\n${context}` : ""}\n\n${quizL.outro}`
          : `${context ? `${tutorL.materials}:\n${context}\n\n` : ""}${tutorL.question}:\n${safeText(request.input)}\n\n${tutorL.outro}`;

        if (this.engine !== engine || !this.ready) {
          throw new Error(
            "Das KI-Modell wurde während der Anfrage verändert."
          );
        }

        const history = sanitizeHistory(request.history);

        const messages = [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: userMessage }
        ];

        // Hinweis: Kein engine.resetChat() aufrufen.
        // In WebLLM 0.2.87 disposed resetChat interne Pipeline-Objekte,
        // die der nächste Streaming-Call noch braucht ("Object has
        // already been disposed"). Wir übergeben die komplette History
        // ohnehin selbst im messages-Array, also ist chat.completions
        // bereits zustandslos genug.

        // Streaming reduziert den Peak-GPU-Speicher drastisch:
        // Tokens werden einzeln geliefert, statt die komplette Antwort
        // vorab in einem großen Buffer zu allozieren. Essentiell für iPads.
        // Hinweis: response_format: { type: "json_object" } ist in
        // WebLLM 0.2.87 fehlerhaft ("Failed to initialize grammar matcher").
        // Wir setzen daher ausschließlich auf prompt-basierte JSON-Ausgabe.
        //
        // max_tokens EXTREM konservativ halten: iPad-Metal OOM-t schon
        // bei ~500 Tokens Streaming-Länge mit mittleren Modellen. Lieber
        // kürzer antworten (und ggf. weniger Übungen liefern) als die
        // GPU zu zerstören. Der Parser nimmt entgegen, was er bekommt
        // und akzeptiert auch 2-3 Übungen bei Anfrage von 5.
        // Format-abhängige Token-Veranschlagung. Werte sind empirisch
        // etwas großzügiger als rechnerisch nötig, weil kleine Modelle
        // gerne verbose formulieren und sonst mitten in Übung 3 stehen
        // bleiben. Deckel 720 – auf iPadOS Safari ist das die Grenze,
        // ab der der WebGPU-Adapter OOMt.
        const quizCount = Number(request.metadata?.quizCount) || 1;
        const quizFormat = request.metadata?.quizFormat || "flashcards";
        const perItem = {
          multipleChoice: 140,
          cloze: 120,
          flashcards: 95
        }[quizFormat] || 100;
        const quizTokens = Math.min(
          720,
          200 + quizCount * perItem
        );

        const longForm = request.metadata?.longForm === true;

        const stream = await engine.chat.completions.create({
          messages,
          temperature: isQuiz ? 0.1 : 0.1,
          max_tokens: isQuiz
            ? Math.max(MAX_OUTPUT_TOKENS_QUIZ, quizTokens)
            : (longForm ? MAX_OUTPUT_TOKENS_REVIEW : MAX_OUTPUT_TOKENS),
          stream: true
        });

        let answer = "";
        let usage = null;
        let streamError = null;

        // Streaming-Fehler nicht sofort als Totalausfall werten:
        // Wenn das Modell schon einen Teil generiert hat, versuchen wir
        // damit zu arbeiten. Der Parser kann meist 2-3 vollständige
        // Übungen aus einer unterbrochenen Antwort herausziehen.
        try {
          for await (const chunk of stream) {
            if (this.engine !== engine || !this.ready) {
              throw new Error(
                "Das KI-Modell wurde während der Anfrage verändert."
              );
            }

            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) answer += delta;

            if (chunk.usage) usage = chunk.usage;
          }
        } catch (midStreamError) {
          streamError = midStreamError;
          console.warn(
            "ATELIER AI: Stream unterbrochen – prüfe, ob Teilantwort nutzbar ist.",
            midStreamError
          );
        }

        const trimmedAnswer = answer.trim();
        const partial = Boolean(streamError);

        // Nur wenn gar nichts Brauchbares zurückkam, geben wir auf.
        // 60 Zeichen entspricht etwa einer halben Übung – darunter kann
        // der Parser realistisch nichts mehr sinnvolles herausziehen.
        if (!trimmedAnswer || trimmedAnswer.length < 60) {
          if (streamError) {
            if (/already been disposed/i.test(String(streamError?.message || ""))) {
              this.engine = null;
              this.ready = false;
              this.status = "error";
            }
            this.error = getFriendlyError(streamError);
            throw new Error(this.error);
          }
          throw new Error("Das Modell hat keine Antwort erzeugt.");
        }

        // Teilantwort vorhanden: Engine ggf. für Folge-Calls als tot
        // markieren, aber den bisher generierten Text als Erfolg
        // zurückgeben – der Parser rettet daraus die vollständigen
        // Übungen.
        if (partial) {
          if (/already been disposed/i.test(String(streamError?.message || ""))) {
            this.engine = null;
            this.ready = false;
            this.status = "error";
            this.error = getFriendlyError(streamError);
          }
          console.warn(
            "ATELIER AI: Nutze Teilantwort (" + trimmedAnswer.length + " Zeichen) " +
            "trotz Streaming-Fehler."
          );
        }

        this.generationCount += 1;

        return {
          status: "success",
          provider: "WebLLM",
          model: modelId,
          answer: trimmedAnswer,
          usage,
          partial
        };

      } catch (error) {
        this.error = getFriendlyError(error);

        // Engine NICHT automatisch als tot markieren. Ein einzelner
        // Fehlschlag heißt nicht, dass das Modell wirklich verloren
        // ist – oft klappt der nächste Versuch wieder. Nur bei
        // eindeutig terminal zerstörtem Engine („disposed") markieren,
        // damit nachfolgende Aufrufe nicht in dieselbe Falle rennen.
        if (/already been disposed/i.test(String(error?.message || ""))) {
          this.engine = null;
          this.ready = false;
          this.status = "error";
        }

        throw new Error(this.error);

      } finally {
        this.generating = false;
      }
    });
  }

  /**
   * Entladen wird hinter alle vorherigen Anfragen gestellt.
   */
  async unload() {
    return this.runExclusive(async () => {
      this.unloading = true;

      const engine = this.engine;

      this.engine = null;
      this.modelId = null;
      this.ready = false;

      try {
        if (engine) {
          await engine.unload();
        }

        this.progress = 0;
        this.status = "not_loaded";
        this.error = null;

        return this.getStatus();

      } catch (error) {
        this.error = getFriendlyError(error);
        this.status = "error";

        throw new Error(this.error);

      } finally {
        this.unloading = false;
      }
    });
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
      generationCount: this.generationCount
    };
  }
}

export const localModel = new LocalModel();

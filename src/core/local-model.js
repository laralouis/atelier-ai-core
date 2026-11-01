
/**
 * ATELIER AI – Local AI Model
 * Version 0.1
 *
 * Lokale KI-Ausführung über WebLLM und WebGPU.
 * Das Modell wird erst nach ausdrücklicher Auswahl geladen.
 */

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm";

const MODEL_PATTERN = /(0\.5B|0\.6B|1B)(?=[-_])/i;

export class LocalModel {
  constructor() {
    this.engine = null;
    this.webllm = null;
    this.modelId = null;
    this.loading = false;
    this.ready = false;
    this.progress = 0;
    this.status = "not_loaded";
    this.error = null;
  }

  /**
   * Prüft, ob WebGPU verfügbar ist.
   */
  async checkSupport() {
    if (!navigator.gpu) {
      return {
        supported: false,
        reason: "WebGPU wird in diesem Browser nicht unterstützt."
      };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();

      if (!adapter) {
        return {
          supported: false,
          reason: "Kein kompatibler GPU-Adapter verfügbar."
        };
      }

      return {
        supported: true,
        reason: "WebGPU ist verfügbar."
      };
    } catch (error) {
      return {
        supported: false,
        reason: error.message
      };
    }
  }

  /**
   * Ermittelt kleine, von WebLLM registrierte Modelle.
   * Es wird dabei noch nichts heruntergeladen.
   */
  async getAvailableModels() {
    if (!this.webllm) {
      this.webllm = await import(WEBLLM_URL);
    }

    return this.webllm.prebuiltAppConfig.model_list
      .filter(model => MODEL_PATTERN.test(model.model_id))
      .map(model => ({
        id: model.model_id,
        name: model.model_id
      }));
  }

  /**
   * Lädt ein ausgewähltes Modell.
   */
  async load(modelId, onProgress = () => {}) {
    if (this.loading) {
      throw new Error("Ein Modell wird bereits geladen.");
    }

    if (this.ready && this.modelId === modelId) {
      return this.getStatus();
    }

    if (!modelId) {
      throw new Error("Bitte zuerst ein Modell auswählen.");
    }

    this.loading = true;
    this.ready = false;
    this.error = null;
    this.status = "checking";
    this.progress = 0;

    try {
      const support = await this.checkSupport();

      if (!support.supported) {
        throw new Error(support.reason);
      }

      if (!this.webllm) {
        this.webllm = await import(WEBLLM_URL);
      }

      const available = this.webllm.prebuiltAppConfig.model_list
        .some(model => model.model_id === modelId);

      if (!available) {
        throw new Error(
          "Dieses Modell ist in WebLLM nicht registriert."
        );
      }

      this.status = "loading";

      this.engine = await this.webllm.CreateMLCEngine(
        modelId,
        {
          initProgressCallback: (report) => {
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

      this.modelId = modelId;
      this.ready = true;
      this.status = "ready";
      this.progress = 100;

      return this.getStatus();

    } catch (error) {
      this.engine = null;
      this.ready = false;
      this.status = "error";
      this.error = error.message;

      throw error;

    } finally {
      this.loading = false;
    }
  }

  /**
   * Erzeugt eine Antwort mit dem lokalen Modell.
   */
  async generate(request) {
    if (!this.ready || !this.engine) {
      throw new Error("Es ist kein lokales Modell geladen.");
    }

    const context = (request.context || [])
      .map(item =>
        `Material: ${item.title}\n${item.content}`
      )
      .join("\n\n");

    const userMessage = context
      ? `${request.input}\n\nBereitgestellte Lernmaterialien:\n${context}`
      : request.input;

    const response = await this.engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content: request.system
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      temperature: 0.5,
      max_tokens: 700
    });

    return {
      status: "success",
      provider: "WebLLM",
      model: this.modelId,
      answer: response.choices[0]?.message?.content || "",
      usage: response.usage || null
    };
  }

  /**
   * Entlädt das Modell aus dem Arbeitsspeicher.
   */
  async unload() {
    if (this.engine) {
      await this.engine.unload();
    }

    this.engine = null;
    this.modelId = null;
    this.ready = false;
    this.loading = false;
    this.progress = 0;
    this.status = "not_loaded";
    this.error = null;

    return this.getStatus();
  }

  getStatus() {
    return {
      ready: this.ready,
      loading: this.loading,
      model: this.modelId,
      progress: this.progress,
      status: this.status,
      error: this.error
    };
  }
}

export const localModel = new LocalModel();

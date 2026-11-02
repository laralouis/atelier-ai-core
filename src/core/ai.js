
/**
 * ATELIER AI – Central AI Coordinator
 * Version 0.2
 *
 * Verbindet den zentralen KI-Kern
 * mit dem lokalen WebLLM-Modell.
 */

import { localModel } from "./local-model.js";

export const ATELIER_CONFIG = {
  name: "ATELIER AI",
  version: "0.2.0",
  language: "de",
  schoolLevel: "Gymnasium Bayern – Jahrgangsstufe 12/13"
};

export const SUBJECTS = [
  "Mathematik",
  "Deutsch",
  "Geographie",
  "Chemie",
  "Musik",
  "Sport",
  "Spanisch",
  "Englisch",
  "Evangelische Religion",
  "Biologie",
  "Politik und Gesellschaft",
  "Geschichte"
];

export const MODULES = {
  learning: "Lernstudio",
  exams: "Probeprüfungen",
  tutor: "Lernassistent",
  writing: "Schreibatelier",
  laboratory: "3D-Labor",
  music: "Musiklabor"
};

const MODES = [
  "explain",
  "quiz",
  "solve",
  "review"
];

export class AtelierAI {
  constructor() {
    this.provider = localModel;
    this.modules = MODULES;
  }

  /**
   * Prüft die lokale GPU-Unterstützung.
   */
  async checkSupport() {
    return await localModel.checkSupport();
  }

  /**
   * Gibt verfügbare kleine Modelle zurück.
   */
  async getAvailableModels() {
    return await localModel.getAvailableModels();
  }

  /**
   * Lädt ein ausgewähltes lokales Modell.
   */
  async loadModel(modelId, onProgress) {
    return await localModel.load(modelId, onProgress);
  }

  /**
   * Entlädt das aktuelle Modell.
   */
  async unloadModel() {
    return await localModel.unload();
  }

  /**
   * Erstellt eine strukturierte Lernanfrage.
   */
  createRequest({
    subject,
    mode,
    question,
    materials = [],
    grade = 12,
    level = "grundlegend"
  }) {
    if (!SUBJECTS.includes(subject)) {
      throw new Error("Unbekanntes Schulfach.");
    }

    if (!MODES.includes(mode)) {
      throw new Error("Unbekannter Lernmodus.");
    }

    if (
      typeof question !== "string" ||
      !question.trim()
    ) {
      throw new Error("Bitte eine Frage eingeben.");
    }

    return {
      system: this.getSystemPrompt({
        subject,
        mode,
        grade,
        level
      }),

      input: question.trim(),

      context: materials.map(material => ({
        title: String(material.title || "Lernmaterial"),
        content: String(material.content || "")
      })),

      metadata: {
        subject,
        mode,
        grade,
        level,
        language: "de"
      }
    };
  }

  /**
   * Erstellt die fachbezogenen Lernanweisungen.
   */
  getSystemPrompt({ subject, mode, grade, level }) {
    return `
Du bist ATELIER AI, ein digitaler Lernassistent.

Schulform: Gymnasium Bayern
Jahrgangsstufe: ${grade}
Fach: ${subject}
Anforderungsniveau: ${level}

Deine Aufgaben:
- Erkläre fachlich korrekt und verständlich.
- Verwende passende Fachbegriffe.
- Strukturiere komplexe Inhalte.
- Passe die Schwierigkeit an die Oberstufe an.
- Erfinde keine Quellen oder Fakten.
- Kennzeichne Unsicherheiten ausdrücklich.
- Nutze bereitgestellte Lernmaterialien vorrangig.
- Unterscheide gesicherte Fakten von Vermutungen.

Lernmodus: ${mode}

${this.getModeInstruction(mode)}

Antworte auf Deutsch, sofern die Aufgabe
keine andere Sprache verlangt.
`;
  }

  getModeInstruction(mode) {
    const instructions = {
      explain:
        "Erkläre das Thema Schritt für Schritt mit Beispielen.",

      quiz:
        "Erstelle die angeforderten Lernübungen im exakt vorgegebenen Ausgabeformat. Halte dich an die Aufgabenstellung der jeweiligen Funktion.",

      solve:
        "Begleite den Lernenden schrittweise. Gib nicht sofort die Gesamtlösung.",

      review:
        "Prüfe die eingereichte Antwort fachlich und begründe deine Rückmeldung."
    };

    return instructions[mode];
  }

  /**
   * Führt eine Lernanfrage mit dem lokalen Modell aus.
   */
  async ask(request) {
    if (!localModel.getStatus().ready) {
      return {
        status: "offline",
        message: "Bitte zuerst ein lokales KI-Modell laden.",
        request
      };
    }

    return await this.provider.generate(request);
  }

  /**
   * Zeigt den aktuellen Systemstatus.
   */
  getStatus() {
    return {
      name: ATELIER_CONFIG.name,
      version: ATELIER_CONFIG.version,
      providerConnected: localModel.getStatus().ready,
      provider: "WebLLM",
      model: localModel.getStatus().model,
      localModel: localModel.getStatus(),
      subjects: SUBJECTS.length,
      modules: Object.keys(MODULES).length
    };
  }
}

export const atelierAI = new AtelierAI();

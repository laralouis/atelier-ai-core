
/**
 * ATELIER AI – Central AI Coordinator
 * Version 0.3
 *
 * Verbindet den zentralen KI-Kern
 * mit dem lokalen WebLLM-Modell.
 */

import { localModel } from "./local-model.js?v=20261103zo";

export const ATELIER_CONFIG = {
  name: "ATELIER AI",
  version: "0.3.0",
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

/**
 * Bestimmt die Arbeitssprache anhand des gewählten Fachs.
 * Englisch → Englisch, Spanisch → Spanisch, sonst Deutsch.
 */
export function getSubjectLanguage(subject) {
  if (subject === "Englisch") return "en";
  if (subject === "Spanisch") return "es";
  return "de";
}

const SUBJECT_IN_LANG = {
  de: {
    Englisch: "Englisch",
    Spanisch: "Spanisch"
  },
  en: {
    Englisch: "English"
  },
  es: {
    Spanisch: "español"
  }
};

function localizedSubject(subject, language) {
  return SUBJECT_IN_LANG[language]?.[subject] || subject;
}

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
   * Lädt das zuletzt verwendete Modell automatisch neu.
   */
  async reloadModel(onProgress) {
    return await localModel.reload(onProgress);
  }

  /**
   * Weiches Zurücksetzen des Chat-States zwischen Batches.
   */
  async softResetChat() {
    return await localModel.softResetChat();
  }

  /**
   * Erstellt eine strukturierte Lernanfrage.
   */
  createRequest({
    subject,
    mode,
    question,
    materials = [],
    history = [],
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

    const language = getSubjectLanguage(subject);

    return {
      system: this.getSystemPrompt({
        subject,
        mode,
        grade,
        level,
        language
      }),

      input: question.trim(),

      context: materials.map(material => ({
        title: String(material.title || "Lernmaterial"),
        content: String(material.content || "")
      })),

      history: Array.isArray(history)
        ? history
            .filter(entry => entry && typeof entry.content === "string")
            .map(entry => ({
              role: entry.role === "assistant" ? "assistant" : "user",
              content: entry.content
            }))
        : [],

      metadata: {
        subject,
        mode,
        grade,
        level,
        language
      }
    };
  }

  /**
   * Erstellt die fachbezogenen Lernanweisungen in passender Sprache.
   */
  getSystemPrompt({ subject, mode, grade, level, language }) {
    const lang = language || getSubjectLanguage(subject);
    const subjectName = localizedSubject(subject, lang);

    if (lang === "en") {
      return `You are ATELIER AI, a learning assistant for ${subjectName} in Year ${grade} of a Bavarian Gymnasium upper school (level: ${level}).

${this.getModeInstruction(mode, lang)}

Additional rules:
- Reply in English, academically accurate and at upper-school level.
- Do not invent sources, facts or page references.
- Mark uncertainties explicitly.
- Do not evade into general explanations when a specific question is asked.`;
    }

    if (lang === "es") {
      return `Eres ATELIER AI, un asistente de aprendizaje de ${subjectName} para el ${grade}º curso del bachillerato bávaro (Gymnasium, nivel: ${level}).

${this.getModeInstruction(mode, lang)}

Reglas adicionales:
- Responde en español, con precisión académica y a nivel de bachillerato superior.
- No inventes fuentes, datos ni referencias de página.
- Señala claramente las dudas o incertidumbres.
- No te evadas con explicaciones generales cuando se formule una pregunta concreta.`;
    }

    return `Du bist ATELIER AI, Lernassistent für ${subjectName} in der ${grade}. Jahrgangsstufe am bayerischen Gymnasium (Niveau: ${level}).

${this.getModeInstruction(mode, lang)}

Weitere Regeln:
- Antworte auf Deutsch, fachlich korrekt und auf Oberstufenniveau.
- Erfinde keine Quellen, Fakten oder Seitenangaben.
- Kennzeichne Unsicherheiten ausdrücklich.
- Weiche nicht zu allgemeinen Erklärungen aus, wenn eine konkrete Frage gestellt wird.`;
  }

  getModeInstruction(mode, language = "de") {
    const instructions = {
      de: {
        explain:
          "Beantworte die konkrete Frage des Schülers direkt. Erläutere nur so viel wie nötig, um die Frage verständlich zu klären. Erkläre nicht das ganze Thema, wenn eine gezielte Antwort gefragt ist.",
        quiz:
          "Erstelle die angeforderten Lernübungen im exakt vorgegebenen Ausgabeformat. Halte dich an die Aufgabenstellung der jeweiligen Funktion.",
        solve:
          "Hilf dem Schüler bei genau dieser Aufgabe schrittweise. Gib Hinweise, bevor du die Gesamtlösung verrätst.",
        review:
          "Prüfe die vom Schüler eingereichte Antwort fachlich und begründe deine Rückmeldung konkret."
      },
      en: {
        explain:
          "Answer the student's specific question directly. Explain only as much as is needed to make the question clear. Do not explain the whole topic when a targeted answer is required.",
        quiz:
          "Create the requested learning exercises in the exact given output format. Stick to the instructions of each function.",
        solve:
          "Help the student with exactly this task step by step. Give hints before revealing the full solution.",
        review:
          "Check the student's submitted answer for accuracy and justify your feedback concretely."
      },
      es: {
        explain:
          "Responde directamente a la pregunta concreta del alumno. Explica solo lo necesario para aclararla. No expliques todo el tema cuando se pide una respuesta puntual.",
        quiz:
          "Crea los ejercicios solicitados en el formato de salida exacto indicado. Sigue las instrucciones específicas de cada función.",
        solve:
          "Ayuda al alumno paso a paso con esta tarea concreta. Da pistas antes de revelar la solución completa.",
        review:
          "Evalúa la respuesta enviada por el alumno con rigor académico y justifica tu valoración de forma concreta."
      }
    };

    return (instructions[language] || instructions.de)[mode];
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

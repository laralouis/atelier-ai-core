
/**
 * ATELIER AI – Learning Studio
 * Version 2.0
 *
 * Hybride Generierung:
 * - Standardmäßig Einzelgenerierung
 * - Validierung jeder einzelnen Übung
 * - Ein Wiederholungsversuch bei fehlerhaften Antworten
 * - Vorbereitet für spätere Bündelgenerierung
 */

import { atelierAI } from "./ai.js";
import { knowledgeBase } from "./knowledge.js";

const FORMATS = {
  flashcards: {
    label: "Karteikarten",
    instruction: `
Erstelle genau eine hochwertige Karteikarte.
Die Karte benötigt eine präzise Frage und eine fachlich korrekte Antwort.
Die Antwort soll verständlich und nicht unnötig lang sein.
`,
    schema: `{"items":[{"question":"Frage","answer":"Antwort"}]}`
  },

  multipleChoice: {
    label: "Multiple Choice",
    instruction: `
Erstelle genau eine Multiple-Choice-Frage.
Sie benötigt vier Antwortmöglichkeiten.
Genau eine Antwort muss richtig sein.
Gib den Index der richtigen Antwort an. Der erste Index ist 0.
Erkläre anschließend kurz, warum die Antwort richtig ist.
`,
    schema: `{"items":[{"question":"Frage","options":["A","B","C","D"],"correctIndex":0,"explanation":"Erklärung"}]}`
  },

  cloze: {
    label: "Lückentexte",
    instruction: `
Erstelle genau eine Lückentext-Aufgabe.
Sie enthält einen fachlich sinnvollen Satz oder kurzen Absatz.
Verwende {{LUECKE}} für jede auszufüllende Stelle.
Gib die korrekten Lösungen und eine kurze Erklärung an.
`,
    schema: `{"items":[{"text":"Satz mit {{LUECKE}}","answers":["Lösung"],"explanation":"Erklärung"}]}`
  }
};

/**
 * Extrahiert ein JSON-Objekt aus der KI-Antwort.
 */
function extractJSON(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "Die KI hat kein JSON-Objekt zurückgegeben."
    );
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      "Ungültiges JSON: " + error.message
    );
  }
}

/**
 * Prüft und vereinheitlicht die Übungen.
 */
function validateItems(format, items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Die KI hat keine Übungen erstellt.");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error("Eine Übung ist fehlerhaft.");
    }

    if (format === "flashcards") {
      if (
        typeof item.question !== "string" ||
        !item.question.trim() ||
        typeof item.answer !== "string" ||
        !item.answer.trim()
      ) {
        throw new Error(`Karte ${index + 1} ist unvollständig.`);
      }

      return {
        question: item.question.trim(),
        answer: item.answer.trim()
      };
    }

    if (format === "multipleChoice") {
      if (
        typeof item.question !== "string" ||
        !item.question.trim() ||
        !Array.isArray(item.options) ||
        item.options.length !== 4 ||
        !item.options.every(
          option => typeof option === "string" && option.trim()
        ) ||
        !Number.isInteger(item.correctIndex) ||
        item.correctIndex < 0 ||
        item.correctIndex > 3 ||
        typeof item.explanation !== "string" ||
        !item.explanation.trim()
      ) {
        throw new Error(
          `Multiple-Choice-Frage ${index + 1} ist unvollständig.`
        );
      }

      return {
        question: item.question.trim(),
        options: item.options.map(option => option.trim()),
        correctIndex: item.correctIndex,
        explanation: item.explanation.trim()
      };
    }

    if (format === "cloze") {
      if (
        typeof item.text !== "string" ||
        !item.text.includes("{{LUECKE}}") ||
        !Array.isArray(item.answers) ||
        !item.answers.length ||
        !item.answers.every(
          answer => typeof answer === "string" && answer.trim()
        ) ||
        typeof item.explanation !== "string" ||
        !item.explanation.trim()
      ) {
        throw new Error(
          `Lückentext ${index + 1} ist unvollständig.`
        );
      }

      return {
        text: item.text.trim(),
        answers: item.answers.map(answer => answer.trim()),
        explanation: item.explanation.trim()
      };
    }

    throw new Error("Unbekanntes Lernformat.");
  });
}

/**
 * Erstellt eine einzelne Übung.
 * Bei einem Fehler wird die Anfrage einmal wiederholt.
 */
async function generateOne({
  format,
  subject,
  topic,
  level,
  materialContext,
  index,
  total
}) {
  const formatConfig = FORMATS[format];

  const prompt = `
Du bist ATELIER AI, ein präziser Lernassistent
für die gymnasiale Oberstufe in Bayern.

Fach: ${subject}
Thema: ${topic}
Niveau: ${level}

AUFGABE:
${formatConfig.instruction}

AUSGABEFORMAT:
${formatConfig.schema}

VERBINDLICHE REGELN:
- Erstelle genau eine Übung.
- Halte dich exakt an das Ausgabeformat.
- Gib ausschließlich gültiges JSON zurück.
- Verwende doppelte Anführungszeichen.
- Keine Kommentare.
- Keine Markdown-Codeblöcke.
- Keine Einleitung.
- Kein Text außerhalb des JSON.
- Keine zusätzlichen JSON-Schlüssel.
- Erfinde keine Quellen oder Fakten.

Gib ausschließlich das JSON-Objekt zurück.
`;

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const request = atelierAI.createRequest({
        subject,
        mode: "quiz",
        question: prompt,
        materials: materialContext,
        grade: 12,
        level
      });

      const response = await atelierAI.ask(request);

      if (!response || response.status === "offline") {
        throw new Error(
          response?.message || "Das KI-Modell ist nicht verfügbar."
        );
      }

      if (
        typeof response.answer !== "string" ||
        !response.answer.trim()
      ) {
        throw new Error("Die KI hat keine Antwort geliefert.");
      }

      const data = extractJSON(response.answer);

      const items = validateItems(
        format,
        data.items
      );

      if (items.length !== 1) {
        throw new Error(
          "Die KI hat nicht genau eine Übung erstellt."
        );
      }

      return items[0];

    } catch (error) {
      lastError = error;

      console.warn(
        `ATELIER AI: Übung ${index + 1}/${total}, Versuch ${attempt} fehlgeschlagen:`,
        error
      );
    }
  }

  throw new Error(
    `Übung ${index + 1} konnte auch nach einem Wiederholungsversuch nicht erstellt werden. ` +
    (lastError?.message || "")
  );
}

/**
 * Learning Studio
 */
export class LearningStudio {

  async generate({
    format,
    subject,
    topic,
    count = 8,
    level = "grundlegend",
    useMaterials = true,
    onProgress = null
  }) {
    if (!FORMATS[format]) {
      throw new Error("Unbekanntes Lernformat.");
    }

    if (!subject || !topic?.trim()) {
      throw new Error("Bitte Fach und Thema angeben.");
    }

    if (!atelierAI.getStatus().localModel.ready) {
      throw new Error("Bitte zuerst ein KI-Modell laden.");
    }

    const amount = Math.max(
      3,
      Math.min(12, Number(count) || 8)
    );

    let materials = [];

    if (useMaterials) {
      materials = await knowledgeBase.search(topic, subject);
    }

    const materialContext = materials.map(item => ({
      title: item.title,
      content: item.content
    }));

    const items = [];

    /**
     * STANDARDMODUS:
     * Jede Übung wird einzeln generiert und validiert.
     *
     * SPÄTERER HYBRIDMODUS:
     * Hier kann eine optionale Bündelgenerierung
     * mit Einzelgenerierung als Fehler-Fallback ergänzt werden.
     */

    for (let index = 0; index < amount; index++) {

      const item = await generateOne({
        format,
        subject,
        topic,
        level,
        materialContext,
        index,
        total: amount
      });

      items.push(item);

      if (typeof onProgress === "function") {
        onProgress({
          completed: items.length,
          total: amount,
          percentage: Math.round(
            (items.length / amount) * 100
          )
        });
      }
    }

    return {
      format,
      formatName: FORMATS[format].label,
      subject,
      topic,
      level,
      items,
      materialCount: materials.length,
      createdAt: new Date().toISOString()
    };
  }
}

export const learningStudio = new LearningStudio();

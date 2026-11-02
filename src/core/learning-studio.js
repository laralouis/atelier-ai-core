// ATELIER AI – Deployment-Test
/**
 * ATELIER AI – Learning Studio
 * Version 1.0
 *
 * Erstellt und bewertet interaktive Lernübungen
 * mit dem lokalen KI-Modell.
 */

import { atelierAI } from "./ai.js";
import { knowledgeBase } from "./knowledge.js";

const FORMATS = {
  flashcards: {
    label: "Karteikarten",
    instruction: `
Erstelle genau {count} hochwertige Karteikarten.
Jede Karte benötigt eine präzise Frage und eine fachlich korrekte Antwort.
Die Antworten sollen verständlich, aber nicht unnötig lang sein.
`
  },

  multipleChoice: {
    label: "Multiple Choice",
    instruction: `
Erstelle genau {count} Multiple-Choice-Fragen.
Jede Frage benötigt vier Antwortmöglichkeiten.
Genau eine Antwort muss richtig sein.
Erkläre anschließend, warum diese Antwort richtig ist.
`
  },

  cloze: {
    label: "Lückentexte",
    instruction: `
Erstelle genau {count} Lückentext-Aufgaben.
Jede Aufgabe enthält einen fachlich sinnvollen Satz oder kurzen Absatz.
Verwende die Schreibweise {{LUECKE}} für jede auszufüllende Stelle.
Gib die korrekten Lösungen und eine Erklärung an.
`
  }
};

function extractJSON(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
  console.error("ATELIER AI – Ungültige KI-Antwort:", text);

  throw new Error(
    "KI-Ausgabe ist kein gültiges JSON. Empfangene Antwort: " +
    String(text || "Keine Antwort").slice(0, 500)
  );
}

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    console.error("ATELIER AI – JSON-Fehler:", error);
    console.error(
      "ATELIER AI – Empfangener JSON-Text:",
      cleaned.slice(start, end + 1)
    );

    throw new Error(
      "JSON-Fehler: " +
      error.message +
      " | KI-Antwort: " +
      cleaned.slice(start, Math.min(end + 1, start + 700))
    );
  }

function validateItems(format, items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Die KI hat keine Übungen erstellt.");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error("Eine Übung ist fehlerhaft.");
    }

    if (format === "flashcards") {
      if (!item.question || !item.answer) {
        throw new Error(`Karte ${index + 1} ist unvollständig.`);
      }

      return {
        question: String(item.question),
        answer: String(item.answer)
      };
    }

    if (format === "multipleChoice") {
      if (
        !item.question ||
        !Array.isArray(item.options) ||
        item.options.length !== 4 ||
        !Number.isInteger(item.correctIndex) ||
        item.correctIndex < 0 ||
        item.correctIndex > 3
      ) {
        throw new Error(
          `Multiple-Choice-Frage ${index + 1} ist unvollständig.`
        );
      }

      return {
        question: String(item.question),
        options: item.options.map(String),
        correctIndex: item.correctIndex,
        explanation: String(item.explanation || "")
      };
    }

    if (format === "cloze") {
      if (
        !item.text ||
        !Array.isArray(item.answers) ||
        !item.answers.length
      ) {
        throw new Error(`Lückentext ${index + 1} ist unvollständig.`);
      }

      return {
        text: String(item.text),
        answers: item.answers.map(String),
        explanation: String(item.explanation || "")
      };
    }

    throw new Error("Unbekanntes Lernformat.");
  });
}

export class LearningStudio {
  async generate({
    format,
    subject,
    topic,
    count = 8,
    level = "grundlegend",
    useMaterials = true
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

    const amount = Math.max(3, Math.min(12, Number(count) || 8));

    let materials = [];

    if (useMaterials) {
      materials = await knowledgeBase.search(topic, subject);
    }

    const materialContext = materials.map(item => ({
      title: item.title,
      content: item.content
    }));

    const formatInstruction = FORMATS[format].instruction
      .replace("{count}", String(amount));

    const prompt = `
Du bist der Lernassistent von ATELIER AI.

AUFGABE:
Erstelle Lernübungen für das Gymnasium Bayern,
Jahrgangsstufe 12/13.

FACH: ${subject}
THEMA: ${topic}
NIVEAU: ${level}

${formatInstruction}

INHALTLICHE REGELN:
- Arbeite fachlich korrekt.
- Orientiere dich vorrangig an den bereitgestellten Unterrichtsmaterialien.
- Ergänze bei Bedarf gesichertes Fachwissen.
- Erfinde keine Quellen oder Seitenangaben.
- Formuliere eindeutige Fragen.
- Vermeide unnötig einfache oder doppeldeutige Aufgaben.
- Verwende bei Bedarf passende Fachbegriffe.

AUSGABE:
Antworte ausschließlich mit einem gültigen JSON-Objekt.
Keine Markdown-Codeblöcke und keine Einleitung.

Für Karteikarten:
{
  "items": [
    {
      "question": "Frage",
      "answer": "Antwort"
    }
  ]
}

Für Multiple Choice:
{
  "items": [
    {
      "question": "Frage",
      "options": [
        "Antwort A",
        "Antwort B",
        "Antwort C",
        "Antwort D"
      ],
      "correctIndex": 0,
      "explanation": "Erklärung"
    }
  ]
}

Für Lückentexte:
{
  "items": [
    {
      "text": "Ein Satz mit {{LUECKE}}.",
      "answers": ["Lösung"],
      "explanation": "Erklärung"
    }
  ]
}

Erstelle genau ${amount} Aufgaben.
`;

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

    const data = extractJSON(response.answer);
    const items = validateItems(format, data.items);

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

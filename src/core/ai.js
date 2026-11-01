
/**
 * ATELIER AI – Central AI Coordinator
 * Version 0.1
 */

export const ATELIER_CONFIG = {
  name: "ATELIER AI",
  version: "0.1.0",
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
    this.provider = null;
    this.modules = MODULES;
  }

  /**
   * Später kann hier ein kostenloser
   * Online- oder Offline-Anbieter
   * angeschlossen werden.
   */
  setProvider(provider) {
    if (!provider || typeof provider.generate !== "function") {
      throw new Error("Ungültiger KI-Anbieter.");
    }

    this.provider = provider;
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

    if (!question || !question.trim()) {
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
   * Fachbezogene Lernanweisungen.
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
        "Stelle zunächst nur eine Frage. Verrate die Lösung nicht.",

      solve:
        "Begleite den Lernenden schrittweise. Gib nicht sofort die Gesamtlösung.",

      review:
        "Prüfe die eingereichte Antwort fachlich und begründe deine Rückmeldung."
    };

    return instructions[mode];
  }

  /**
   * Übergibt die Anfrage an einen angeschlossenen Anbieter.
   */
  async ask(request) {
    if (!this.provider) {
      return {
        status: "offline",
        message:
          "Noch ist kein generatives KI-Modell angeschlossen.",
        request
      };
    }

    return await this.provider.generate(request);
  }

  getStatus() {
    return {
      name: ATELIER_CONFIG.name,
      version: ATELIER_CONFIG.version,
      providerConnected: Boolean(this.provider),
      subjects: SUBJECTS.length,
      modules: Object.keys(MODULES).length
    };
  }
}

export const atelierAI = new AtelierAI();

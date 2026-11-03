
/**
 * ATELIER AI – Learning Studio
 * Version 2.1
 *
 * Hybride Generierung:
 * - Standardmäßig Einzelgenerierung
 * - Validierung jeder einzelnen Übung
 * - Mehrsprachige Erzeugung je nach Fach (DE/EN/ES)
 */

import { atelierAI, getSubjectLanguage } from "./ai.js?v=20261103zb";
import { knowledgeBase } from "./knowledge.js?v=20261103zb";

function pickLang(language) {
  if (language === "en" || language === "es") return language;
  return "de";
}

// Lenient key-regexes that accept the equivalent label in all three
// supported languages. Keeps the parsers robust when the small model
// mixes languages slightly.
const KEYS = {
  question: "(?:Frage|Question|Pregunta)",
  answer: "(?:Antwort|Answer|Respuesta)",
  correct: "(?:Richtig(?:e\\s+Antwort)?|Correct(?:\\s+Answer)?|Correcta|Respuesta\\s+correcta|L(?:ö|oe)sung|Soluci(?:ó|o)n|Antwort)",
  explanation: "(?:Erkl(?:ä|a)rung|Explanation|Explicaci(?:ó|o)n|Begr(?:ü|u)ndung|Reasoning|Justificaci(?:ó|o)n)",
  sentence: "(?:Satz|L(?:ü|u)ckentext|Text|Aufgabe|Sentence|Cloze|Oraci(?:ó|o)n|Frase|Enunciado)",
  solutions: "(?:L(?:ö|oe)sungen?|Solutions?|Soluciones?|Answers?|Respuestas?|Antwort(?:en)?)"
};

function normalizeForCompare(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:()"'`´*_\-\u2013\u2014]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Entfernt Markdown-Formatierungen, Codeblöcke, führende Aufzählungs-
 * zeichen und sonstige Deko, bevor der Parser arbeitet. Kleine Modelle
 * tendieren dazu, die Antwort in **Fett** oder `` ` `` zu packen.
 */
function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[>•·]\s+/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .trim();
}

const FORMATS = {
  flashcards: {
    label: {
      de: "Karteikarten",
      en: "Flashcards",
      es: "Tarjetas de aprendizaje"
    },
    instruction: {
      de: "Erstelle eine Lernkarte mit einer präzisen Frage und einer sehr knappen, fachlich korrekten Antwort (höchstens 1-2 Sätze, maximal etwa 25 Wörter).",
      en: "Create a flashcard with one precise question and a very concise, academically accurate answer (at most 1-2 sentences, around 25 words).",
      es: "Crea una tarjeta de aprendizaje con una pregunta precisa y una respuesta muy breve y académicamente correcta (como máximo 1-2 oraciones, alrededor de 25 palabras)."
    },
    template: {
      de:
`Frage: <deine konkrete Frage zum Thema>
Antwort: <knappe fachliche Antwort, maximal 1-2 Sätze>`,
      en:
`Question: <your specific question about the topic>
Answer: <concise academic answer, at most 1-2 sentences>`,
      es:
`Pregunta: <tu pregunta concreta sobre el tema>
Respuesta: <respuesta académica breve, máximo 1-2 oraciones>`
    },
    parse(text) {
      const clean = stripMarkdown(text);
      const q = clean.match(new RegExp(`${KEYS.question}\\s*[:\\-]?\\s*(.+)`, "i"))?.[1]?.trim();
      const aMatch =
        clean.match(new RegExp(`${KEYS.answer}\\s*[:\\-]?\\s*([\\s\\S]+?)(?=\\n\\s*(?:${KEYS.question}|$))`, "i"))
        || clean.match(new RegExp(`${KEYS.answer}\\s*[:\\-]?\\s*([\\s\\S]+)$`, "i"));
      const a = aMatch?.[1]?.trim();

      if (!q || !a) {
        throw new Error("Antwort folgt nicht dem Format 'Frage/Question/Pregunta: … / Antwort/Answer/Respuesta: …'.");
      }
      if (q.length < 5 || a.length < 5) {
        throw new Error("Frage oder Antwort ist zu kurz.");
      }

      return [{ question: q, answer: a }];
    }
  },

  multipleChoice: {
    label: {
      de: "Multiple Choice",
      en: "Multiple Choice",
      es: "Opción múltiple"
    },
    instruction: {
      de: "Erstelle eine Multiple-Choice-Frage mit vier Antworten (A–D), bei der genau eine korrekt ist, plus eine kurze Erklärung.",
      en: "Create a multiple-choice question with four answers (A–D) where exactly one is correct, plus a short explanation.",
      es: "Crea una pregunta de opción múltiple con cuatro respuestas (A–D) de las que solo una es correcta, más una breve explicación."
    },
    template: {
      de:
`Frage: <deine Frage>
A: <Antwort A>
B: <Antwort B>
C: <Antwort C>
D: <Antwort D>
Richtig: <A, B, C oder D>
Erklärung: <kurze fachliche Begründung>`,
      en:
`Question: <your question>
A: <answer A>
B: <answer B>
C: <answer C>
D: <answer D>
Correct: <A, B, C or D>
Explanation: <short academic justification>`,
      es:
`Pregunta: <tu pregunta>
A: <respuesta A>
B: <respuesta B>
C: <respuesta C>
D: <respuesta D>
Correcta: <A, B, C o D>
Explicación: <breve justificación académica>`
    },
    parse(text) {
      const clean = stripMarkdown(text);

      const matchLine = (letter) =>
        clean.match(
          new RegExp(`^\\s*(?:\\(?${letter}\\)?|${letter})\\s*[:)\\].\\-\u2013\u2014]\\s*(.+)$`, "im")
        )?.[1]?.trim();

      const matchNumbered = (num) =>
        clean.match(
          new RegExp(`^\\s*\\(?${num}\\)?\\s*[:)\\].\\-\u2013\u2014]\\s*(.+)$`, "im")
        )?.[1]?.trim();

      const q = clean.match(new RegExp(`${KEYS.question}\\s*[:\\-]?\\s*(.+)`, "i"))?.[1]?.trim();
      let a = matchLine("A");
      let b = matchLine("B");
      let c = matchLine("C");
      let d = matchLine("D");

      // Fallback: Modell nummeriert mit 1./2./3./4. statt A/B/C/D.
      if (!a && !b && !c && !d) {
        a = matchNumbered("1");
        b = matchNumbered("2");
        c = matchNumbered("3");
        d = matchNumbered("4");
      }

      let correct = (
        clean.match(new RegExp(`${KEYS.correct}\\s*[:\\-]?\\s*\\(?\\s*([A-D])\\)?`, "i"))?.[1]
        || ""
      ).toUpperCase();

      // Fallback: Modell gibt die richtige Antwort als Ziffer (1-4) an.
      if (!correct) {
        const num = clean.match(new RegExp(`${KEYS.correct}\\s*[:\\-]?\\s*\\(?\\s*([1-4])\\)?`, "i"))?.[1];
        if (num) correct = "ABCD"[Number(num) - 1];
      }

      const explanation =
        clean.match(new RegExp(`${KEYS.explanation}\\s*[:\\-]?\\s*([\\s\\S]+?)(?=\\n\\s*(?:${KEYS.question}|$))`, "i"))?.[1]?.trim()
        || clean.match(new RegExp(`${KEYS.explanation}\\s*[:\\-]?\\s*([\\s\\S]+)$`, "i"))?.[1]?.trim();

      if (!q) throw new Error("Keine Frage gefunden.");
      if (!a || !b || !c || !d) {
        throw new Error("Nicht alle vier Antwortmöglichkeiten (A–D) gefunden.");
      }
      if (!correct || !"ABCD".includes(correct)) {
        throw new Error("Keine gültige richtige Antwort (A–D) angegeben.");
      }
      if (!explanation) throw new Error("Keine Erklärung gefunden.");

      const normalizedOptions = [a, b, c, d].map(normalizeForCompare);
      if (new Set(normalizedOptions).size !== 4) {
        throw new Error(
          "Die Antwortmöglichkeiten A–D sind nicht alle verschieden – jede Option muss einen anderen Inhalt haben."
        );
      }

      return [{
        question: q,
        options: [a, b, c, d],
        correctIndex: "ABCD".indexOf(correct),
        explanation
      }];
    }
  },

  cloze: {
    label: {
      de: "Lückentexte",
      en: "Cloze exercises",
      es: "Ejercicios de huecos"
    },
    instruction: {
      de: "Erstelle einen Lückentext. Verwende {{LUECKE}} für jede Lücke und gib die Lösungen in der Reihenfolge der Lücken an.",
      en: "Create a cloze exercise. Use {{LUECKE}} for every blank and list the solutions in the order of the blanks.",
      es: "Crea un ejercicio de huecos. Usa {{LUECKE}} para cada hueco y escribe las soluciones en el orden de los huecos."
    },
    template: {
      de:
`Satz: <satz mit {{LUECKE}} für jede Lücke>
Lösungen: <lösung 1>; <lösung 2>; ...
Erklärung: <kurze fachliche Erklärung>`,
      en:
`Sentence: <sentence with {{LUECKE}} for each blank>
Solutions: <solution 1>; <solution 2>; ...
Explanation: <short academic explanation>`,
      es:
`Oración: <oración con {{LUECKE}} para cada hueco>
Soluciones: <solución 1>; <solución 2>; ...
Explicación: <breve explicación académica>`
    },
    parse(text) {
      let clean = stripMarkdown(text);

      let sentence =
        clean.match(new RegExp(`${KEYS.sentence}\\s*[:\\-]?\\s*(.+)`, "i"))?.[1]?.trim();

      const solutions =
        clean.match(new RegExp(`${KEYS.solutions}\\s*[:\\-]?\\s*([^\\n]+)`, "i"))?.[1]?.trim();

      const explanation =
        clean.match(new RegExp(`${KEYS.explanation}\\s*[:\\-]?\\s*([\\s\\S]+?)(?=\\n\\s*(?:${KEYS.sentence}|$))`, "i"))?.[1]?.trim()
        || clean.match(new RegExp(`${KEYS.explanation}\\s*[:\\-]?\\s*([\\s\\S]+)$`, "i"))?.[1]?.trim();

      if (!sentence) throw new Error("Kein Satz gefunden.");
      if (!solutions) throw new Error("Keine Lösungen gefunden.");
      if (!explanation) throw new Error("Keine Erklärung gefunden.");

      sentence = sentence
        .replace(/_{3,}/g, "{{LUECKE}}")
        .replace(/\[\s*(?:lücke|luecke|blank|hueco|_+|\.{3,}|\?+)\s*\]/gi, "{{LUECKE}}")
        .replace(/\(\s*(?:lücke|luecke|blank|hueco|_+|\.{3,}|\?+)\s*\)/gi, "{{LUECKE}}")
        .replace(/\{\{\s*(?:lücke|luecke|blank|hueco|gap)\s*\}\}/gi, "{{LUECKE}}");

      if (!sentence.includes("{{LUECKE}}")) {
        throw new Error("Satz enthält keine Lücke.");
      }

      const answers = solutions
        .split(/[;,\u2013\u2014]|\s+(?:und|and|y)\s+/i)
        .map(a => a.replace(/^\d+[.)]\s*/, "").trim())
        .filter(Boolean);

      if (!answers.length) {
        throw new Error("Keine Lösungen angegeben.");
      }

      return [{
        text: sentence,
        answers,
        explanation
      }];
    }
  }
};

function looksLikePlaceholder(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^<[^>]*>$/.test(trimmed)) return true;
  if (/^(Frage|Antwort|Erklärung|Lösung|Question|Answer|Explanation|Solution|Pregunta|Respuesta|Explicación|Solución|\.\.\.)$/i.test(trimmed)) return true;
  if (/\b(hier (deine|dein)|einsetzen|platzhalter|placeholder|insert here|aquí tu|insertar)\b/i.test(trimmed)) return true;
  return false;
}

/**
 * Holt eine kurze Einleitung aus der zum Fach passenden Wikipedia.
 * DE: de.wikipedia.org, EN: en.wikipedia.org, ES: es.wikipedia.org.
 */
async function fetchWikipediaContext(topic, language = "de") {
  const query = encodeURIComponent(String(topic || "").trim());
  if (!query) return null;

  const lang = pickLang(language);
  const host = `${lang}.wikipedia.org`;

  const url =
    `https://${host}/w/api.php` +
    "?action=query&format=json&prop=extracts" +
    "&exintro=1&explaintext=1&redirects=1" +
    "&titles=" + query +
    "&origin=*";

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    const extract = page?.extract?.trim();
    if (!extract || extract.length < 80) return null;

    const topicLower = String(topic || "").toLowerCase();
    const firstWord = topicLower.split(/\s+/)[0];
    if (
      firstWord &&
      firstWord.length > 3 &&
      !extract.toLowerCase().includes(firstWord)
    ) {
      return null;
    }

    const title = page.title || topic;
    const label = {
      de: "[Externe Quelle] Wikipedia",
      en: "[External source] Wikipedia",
      es: "[Fuente externa] Wikipedia"
    }[lang];

    return {
      title: `${label}: ${title}`,
      content: extract.slice(0, 250)
    };
  } catch (error) {
    console.warn(
      "ATELIER AI: Wikipedia-Abruf fehlgeschlagen:",
      error
    );
    return null;
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
        !item.answer.trim() ||
        looksLikePlaceholder(item.question) ||
        looksLikePlaceholder(item.answer)
      ) {
        throw new Error(
          `Karte ${index + 1} enthält keine echten Inhalte (Platzhalter oder leer).`
        );
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
        !item.explanation.trim() ||
        looksLikePlaceholder(item.question) ||
        looksLikePlaceholder(item.explanation) ||
        item.options.some(looksLikePlaceholder)
      ) {
        throw new Error(
          `Multiple-Choice-Frage ${index + 1} enthält keine echten Inhalte.`
        );
      }

      const trimmedOptions = item.options.map(option => option.trim());
      if (new Set(trimmedOptions.map(normalizeForCompare)).size !== 4) {
        throw new Error(
          `Multiple-Choice-Frage ${index + 1} enthält doppelte Antwortmöglichkeiten.`
        );
      }

      return {
        question: item.question.trim(),
        options: trimmedOptions,
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
        !item.explanation.trim() ||
        looksLikePlaceholder(item.explanation) ||
        item.answers.some(looksLikePlaceholder)
      ) {
        throw new Error(
          `Lückentext ${index + 1} enthält keine echten Inhalte.`
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

const MC_RULES = {
  de: "- Die vier Antwortmöglichkeiten A, B, C und D MÜSSEN jeweils einen UNTERSCHIEDLICHEN Inhalt haben. Nur eine davon ist richtig, die drei anderen sind plausible, aber eindeutig falsche Alternativen.",
  en: "- The four options A, B, C and D MUST each have a DIFFERENT content. Only one is correct, the other three are plausible but clearly incorrect alternatives.",
  es: "- Las cuatro opciones A, B, C y D DEBEN tener un contenido DISTINTO cada una. Solo una es correcta; las otras tres son alternativas verosímiles pero claramente incorrectas."
};

const KNOWLEDGE_RULES = {
  de: {
    withMaterials: "- Nutze die bereitgestellten Materialien vorrangig und ergänze mit deinem Fachwissen, wo nötig.",
    withoutMaterials: "- Nutze dein gesichertes Oberstufen-Fachwissen zum Thema."
  },
  en: {
    withMaterials: "- Prefer the provided materials and complement them with your own expertise where needed.",
    withoutMaterials: "- Draw on your reliable upper-school knowledge of the topic."
  },
  es: {
    withMaterials: "- Da prioridad a los materiales proporcionados y complétalos con tus conocimientos cuando sea necesario.",
    withoutMaterials: "- Basa la respuesta en tus conocimientos sólidos de bachillerato sobre el tema."
  }
};

/**
 * Erzeugt den Prompt für eine komplette Batch-Generierung aller Übungen
 * in einem einzigen Modell-Aufruf. Spart auf dem iPad kritische
 * GPU-Inferenzen ein – statt N Einzel-Streams nur noch ein Stream.
 */
function buildBatchPrompt({
  format,
  lang,
  topic,
  subject,
  level,
  count,
  hasMaterials
}) {
  const knowledge = hasMaterials
    ? KNOWLEDGE_RULES[lang].withMaterials
    : KNOWLEDGE_RULES[lang].withoutMaterials;

  const formatConfig = FORMATS[format];
  const singleTemplate = formatConfig.template[lang];

  const mcLine = format === "multipleChoice"
    ? "\n" + MC_RULES[lang]
    : "";

  const headwords = {
    de: {
      topic: "Thema",
      subject: "Fach",
      task: "Aufgabe",
      count: "Übungen",
      format: "Verwende EXAKT dieses Format für jede Übung. Trenne die Übungen mit einer Leerzeile. Beginne jede neue Übung mit einer Zeile wie 'Übung 1:', 'Übung 2:' …",
      rules: "Regeln",
      ruleLevel: `Oberstufen-Niveau (${level}), fachlich korrekt, auf Deutsch.`,
      ruleFormat: "Nur das Textformat, keine Einleitung, kein Markdown, keine Codeblöcke, kein Fließtext zwischen den Übungen.",
      ruleTopic: `Jede Übung MUSS einen Begriff aus "${topic}" verwenden.`,
      ruleUnique: "Jede Übung behandelt einen ANDEREN Aspekt – keine inhaltlichen Wiederholungen zwischen den Übungen.",
      startCue: `Erzeuge jetzt ${count} verschiedene Übungen zum Thema "${topic}" (Fach: ${subject}).`
    },
    en: {
      topic: "Topic",
      subject: "Subject",
      task: "Task",
      count: "exercises",
      format: "Use EXACTLY this format for each exercise. Separate exercises with a blank line. Start each new exercise with a line like 'Exercise 1:', 'Exercise 2:' …",
      rules: "Rules",
      ruleLevel: `Upper-school level (${level}), academically correct, in English.`,
      ruleFormat: "Only the text format – no preamble, no markdown, no code blocks, no running text between exercises.",
      ruleTopic: `Every exercise MUST use a term from "${topic}".`,
      ruleUnique: "Each exercise must cover a DIFFERENT aspect – no content repetitions between exercises.",
      startCue: `Now generate ${count} distinct exercises about the topic "${topic}" (Subject: ${subject}).`
    },
    es: {
      topic: "Tema",
      subject: "Asignatura",
      task: "Tarea",
      count: "ejercicios",
      format: "Utiliza EXACTAMENTE este formato para cada ejercicio. Separa los ejercicios con una línea en blanco. Comienza cada ejercicio nuevo con una línea del tipo 'Ejercicio 1:', 'Ejercicio 2:' …",
      rules: "Reglas",
      ruleLevel: `Nivel de bachillerato superior (${level}), académicamente correcto, en español.`,
      ruleFormat: "Solo el formato de texto – sin introducción, sin markdown, sin bloques de código, sin texto corrido entre ejercicios.",
      ruleTopic: `Cada ejercicio DEBE usar un término de "${topic}".`,
      ruleUnique: "Cada ejercicio debe tratar un aspecto DIFERENTE – sin repeticiones de contenido entre ejercicios.",
      startCue: `Genera ahora ${count} ejercicios distintos sobre el tema "${topic}" (Asignatura: ${subject}).`
    }
  };

  const h = headwords[lang];

  const instruction = formatConfig.instruction[lang];

  return `${h.topic}: "${topic}" (${h.subject}: ${subject})

${h.task}: Erstelle genau ${count} ${h.count}. ${instruction}

${h.format}

${singleTemplate}

${h.rules}:
${knowledge}
- ${h.ruleLevel}
- ${h.ruleFormat}
- ${h.ruleTopic}
- ${h.ruleUnique}${mcLine}

${h.startCue}`;
}

/**
 * Teilt eine Batch-Antwort anhand des Primär-Schlüssels (Frage / Question /
 * Pregunta bzw. Satz / Sentence / Oración) in einzelne Übungsblöcke.
 * Zusätzlich erkennt die Funktion „Übung N"-/„Exercise N"-/
 * „Ejercicio N"-Separatoren.
 */
function splitIntoBlocks(text, primaryKey) {
  const clean = stripMarkdown(text);

  // Zuerst versuchen, an expliziten "Übung N" / "Ejercicio N"-Trennern
  // zu splitten – das ist am robustesten.
  const sectionRe = /^\s*(?:Übung|Ubung|Uebung|Exercise|Ejercicio|Flashcard|Karte|Tarjeta|MC|Multiple\s*Choice)\s*\d+\s*[:\-]?.*$/gim;

  let sections;
  if (sectionRe.test(clean)) {
    sectionRe.lastIndex = 0;
    const indices = [];
    let m;
    while ((m = sectionRe.exec(clean)) !== null) {
      indices.push(m.index);
    }
    sections = indices.map((start, i) => {
      const end = i + 1 < indices.length ? indices[i + 1] : clean.length;
      return clean.slice(start, end).trim();
    });
  } else {
    // Fallback: an jedem Vorkommen des Primär-Schlüssels splitten.
    // Erfasst auch "Frage 1:", "Frage:" usw.
    const primRe = new RegExp(
      `^\\s*${primaryKey}\\s*\\d*\\s*[:\\-]`,
      "gim"
    );
    const indices = [];
    let m;
    while ((m = primRe.exec(clean)) !== null) {
      indices.push(m.index);
    }
    if (indices.length === 0) {
      return [clean];
    }
    sections = indices.map((start, i) => {
      const end = i + 1 < indices.length ? indices[i + 1] : clean.length;
      return clean.slice(start, end).trim();
    });
  }

  return sections.filter(section => section.length > 0);
}

async function generateBatch({
  format,
  subject,
  topic,
  level,
  materialContext,
  count,
  language
}) {
  const lang = pickLang(language);
  const formatConfig = FORMATS[format];

  const hasMaterials = Array.isArray(materialContext)
    && materialContext.length > 0;

  const prompt = buildBatchPrompt({
    format,
    lang,
    topic,
    subject,
    level,
    count,
    hasMaterials
  });

  if (!atelierAI.getStatus().localModel.ready) {
    throw new Error(
      "Das KI-Modell ist nicht mehr bereit. " +
      "Bitte unter „KI-Modell\" einmal entladen und neu laden."
    );
  }

  const request = atelierAI.createRequest({
    subject,
    mode: "quiz",
    question: prompt,
    materials: materialContext,
    grade: 12,
    level
  });

  // Hinweis für local-model.js, den Token-Budget passend hochzudrehen.
  request.metadata.quizCount = count;

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

  const raw = response.answer;

  // Primär-Schlüssel je Format wählen – darüber trennen wir Blöcke.
  const primaryKey = format === "cloze" ? KEYS.sentence : KEYS.question;

  const blocks = splitIntoBlocks(raw, primaryKey);

  const items = [];
  const parseErrors = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      const parsed = formatConfig.parse(block);
      const validated = validateItems(format, parsed);
      items.push(...validated);
    } catch (err) {
      parseErrors.push({ index: i + 1, message: err?.message || String(err) });
    }
  }

  if (items.length === 0) {
    console.warn(
      "ATELIER AI: Batch-Parse ohne Treffer. Rohantwort (gekürzt):",
      raw.slice(0, 1200)
    );
    console.warn(
      "ATELIER AI: Parse-Fehler je Block:",
      parseErrors
    );
    throw new Error(
      "Die KI-Antwort konnte nicht in Übungen zerlegt werden."
    );
  }

  return { items, raw, parseErrors };
}

/**
 * Learning Studio
 */
export class LearningStudio {

  async generate({
    format,
    subject,
    topic,
    count = 5,
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

    const language = pickLang(getSubjectLanguage(subject));

    const previousGenerations =
      atelierAI.getStatus().localModel.generationCount || 0;

    if (previousGenerations > 0) {
      try {
        await atelierAI.softResetChat();
      } catch (resetError) {
        console.warn(
          "ATELIER AI: Weiches Zurücksetzen fehlgeschlagen (ignoriert):",
          resetError?.message || resetError
        );
      }
    }

    const amount = Math.max(
      3,
      Math.min(10, Number(count) || 5)
    );

    let materials = [];

    if (useMaterials) {
      materials = await knowledgeBase.search(topic, subject);
    }

    if (useMaterials && materials.length === 0) {
      const external = await fetchWikipediaContext(topic, language);
      if (external) materials = [external];
    }

    const materialContext = materials.map(item => ({
      title: item.title,
      content: item.content
    }));

    let items = [];
    const failures = [];
    let modelUnrecoverable = false;

    const gpuDeathPattern = /nicht mehr bereit|KI-Modell.*entladen|Browser-Tab komplett schließen|disposed|GPU-Zustand verloren|Grafikspeicher/i;

    if (typeof onProgress === "function") {
      onProgress({
        completed: 0,
        attempted: 0,
        total: amount,
        percentage: 5
      });
    }

    // Batch-Generierung: alle Übungen in einem einzigen Modell-Aufruf.
    // Das reduziert die GPU-Belastung auf dem iPad massiv – statt N
    // Streams (die den WebGPU-Adapter verschleißen) läuft nur einer.
    try {
      const result = await generateBatch({
        format,
        subject,
        topic,
        level,
        materialContext,
        count: amount,
        language
      });
      items = result.items;
    } catch (error) {
      failures.push({
        index: 1,
        message: error?.message || String(error)
      });
      if (gpuDeathPattern.test(String(error?.message || ""))) {
        modelUnrecoverable = true;
      }
      console.warn("ATELIER AI: Batch-Generierung fehlgeschlagen:", error);
    }

    // Automatische Rettung bei GPU-Verlust: Modell im Hintergrund neu
    // laden, dann einen kleineren Batch versuchen. Die Modell-Datei
    // liegt bereits im IndexedDB-Cache – es wird nur die WebGPU-Pipeline
    // neu aufgebaut, kein Netzwerk-Download.
    //
    // Zwei Anläufe: iPadOS Safari gibt den GPU-Adapter nach einem Dispose
    // manchmal erst nach 10+ Sekunden wieder frei. Wenn der erste
    // Rettungsversuch wegen „GPU-Zugriff blockiert" scheitert, warten
    // wir länger und versuchen es noch einmal.
    const reloadAttempts = [
      { label: "KI-Modell wird automatisch neu geladen …", preWait: 0 },
      { label: "GPU reagiert noch nicht – zweiter Rettungsversuch …", preWait: 6000 }
    ];

    for (const attempt of reloadAttempts) {
      if (items.length > 0 || !modelUnrecoverable) break;

      console.warn(
        "ATELIER AI: GPU-Zustand verloren – " +
        (attempt.preWait > 0 ? "zweiter " : "") +
        "automatischer Neuladeversuch."
      );

      if (attempt.preWait > 0) {
        if (typeof onProgress === "function") {
          onProgress({
            completed: 0,
            attempted: 0,
            total: amount,
            percentage: 20,
            note: "GPU-Zugriff war blockiert – iPad bekommt kurz Zeit, den Adapter freizugeben …"
          });
        }
        await new Promise(resolve => setTimeout(resolve, attempt.preWait));
      }

      if (typeof onProgress === "function") {
        onProgress({
          completed: 0,
          attempted: 0,
          total: amount,
          percentage: attempt.preWait > 0 ? 30 : 15,
          note: attempt.label
        });
      }

      try {
        await atelierAI.reloadModel(report => {
          if (typeof onProgress === "function") {
            onProgress({
              completed: 0,
              attempted: 0,
              total: amount,
              percentage: 30 + Math.round((report?.progress || 0) * 0.3),
              note: report?.text || "KI-Modell wird neu geladen …"
            });
          }
        });
        modelUnrecoverable = false;

        // Kleine Pause, bevor wir den WebGPU-Adapter wieder belasten.
        await new Promise(resolve => setTimeout(resolve, 400));

        if (typeof onProgress === "function") {
          onProgress({
            completed: 0,
            attempted: 0,
            total: amount,
            percentage: 65,
            note: "Übungen werden erzeugt …"
          });
        }
        break;
      } catch (reloadError) {
        failures.push({
          index: failures.length + 1,
          message:
            "Automatisches Neuladen fehlgeschlagen: " +
            (reloadError?.message || String(reloadError))
        });
        modelUnrecoverable = true;
        console.warn("ATELIER AI: Automatisches Neuladen fehlgeschlagen:", reloadError);
      }
    }

    // Falls die Batch-Antwort überhaupt keine gültige Übung lieferte
    // und das Modell NOCH lebt (ggf. nach automatischem Neuladen):
    // ein zweiter, kleinerer Versuch. Mehr nicht – jede weitere
    // Inferenz riskiert den GPU-Zustand.
    if (
      items.length === 0 &&
      !modelUnrecoverable &&
      atelierAI.getStatus().localModel.ready
    ) {
      console.warn(
        "ATELIER AI: Batch leer – ein zweiter Versuch mit kleinerer Anfrage."
      );
      try {
        const result = await generateBatch({
          format,
          subject,
          topic,
          level,
          materialContext,
          count: Math.min(3, amount),
          language
        });
        items = result.items;
      } catch (retryError) {
        failures.push({
          index: 3,
          message: retryError?.message || String(retryError)
        });
        if (gpuDeathPattern.test(String(retryError?.message || ""))) {
          modelUnrecoverable = true;
        }
      }
    }

    if (typeof onProgress === "function") {
      onProgress({
        completed: items.length,
        attempted: amount,
        total: amount,
        percentage: 100
      });
    }

    if (items.length === 0) {
      const lastMessage =
        failures[failures.length - 1]?.message || "unbekannt";

      throw new Error(
        "Es konnte keine einzige Übung erstellt werden. " +
        "Letzter Grund: " + lastMessage +
        (modelUnrecoverable
          ? ""
          : " – Falls das Problem anhält: Browser-Tab komplett schließen und Seite neu öffnen.")
      );
    }

    // Falls das Modell weniger als die gewünschte Anzahl geliefert hat,
    // ist das okay – wir geben zurück, was wir haben.
    if (items.length > amount) {
      items = items.slice(0, amount);
    }

    const usedExternalSource = materials.some(item => {
      const t = String(item.title || "").toLowerCase();
      return t.includes("[externe quelle]")
        || t.includes("[external source]")
        || t.includes("[fuente externa]");
    });

    return {
      format,
      formatName: FORMATS[format].label[language],
      subject,
      topic,
      level,
      language,
      items,
      materialCount: materials.length,
      usedExternalSource,
      requested: amount,
      failures,
      createdAt: new Date().toISOString()
    };
  }
}

export const learningStudio = new LearningStudio();

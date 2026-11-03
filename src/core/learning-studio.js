
/**
 * ATELIER AI – Learning Studio
 * Version 2.2
 *
 * Hybride Generierung:
 * - Standardmäßig Einzelgenerierung
 * - Validierung jeder einzelnen Übung
 * - Mehrsprachige Erzeugung je nach Fach (DE/EN/ES)
 * - Letzter Rettungsanker, der aus beliebigem Rohtext mindestens eine
 *   Übung baut – lieber eine imperfekte Karte als eine Fehlermeldung.
 */

import { atelierAI, getSubjectLanguage } from "./ai.js?v=20261103zn";
import { knowledgeBase } from "./knowledge.js?v=20261103zn";

const BUILD = "20261103zn";

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
`Übung <nr>:
Frage: <eine konkrete Frage, die mit einem Fragezeichen endet>
Antwort: <knappe fachliche Antwort, maximal 1-2 Sätze>`,
      en:
`Exercise <nr>:
Question: <a specific question that ends with a question mark>
Answer: <concise academic answer, at most 1-2 sentences>`,
      es:
`Ejercicio <nr>:
Pregunta: <una pregunta concreta que termine con signo de interrogación>
Respuesta: <respuesta académica breve, máximo 1-2 oraciones>`
    },
    example: {
      de:
`Übung 1:
Frage: Welche Rolle spielt der Choral im Gregorianischen Repertoire?
Antwort: Der Choral bildet die liturgische Grundform des Gregorianischen Repertoires und ist einstimmig, unbegleitet und modal.

Übung 2:
Frage: Wodurch unterscheidet sich der Gregorianische Choral vom späteren mehrstimmigen Gesang?
Antwort: Er ist monodisch, ohne harmonische Begleitung, und folgt den Kirchentonarten statt Dur/Moll.`,
      en:
`Exercise 1:
Question: What role does Gregorian chant play in medieval liturgy?
Answer: It serves as the monophonic, unaccompanied liturgical music of the Western Church, sung in the eight church modes.

Exercise 2:
Question: How does Gregorian chant differ from later polyphonic music?
Answer: It is monophonic and modal, whereas polyphonic music adds multiple independent voices and uses major/minor tonality.`,
      es:
`Ejercicio 1:
Pregunta: ¿Qué función cumple el canto gregoriano en la liturgia medieval?
Respuesta: Es la música litúrgica monódica y sin acompañamiento de la Iglesia occidental, cantada en los ocho modos eclesiásticos.

Ejercicio 2:
Pregunta: ¿En qué se diferencia el canto gregoriano de la polifonía posterior?
Respuesta: Es monódico y modal, mientras que la polifonía añade varias voces independientes y usa tonalidad mayor/menor.`
    },
    parse(text) {
      // Separator-Klasse inkl. Unicode-Bindestriche (– —) und →.
      const SEP = "[:\\-\\u2013\\u2014\\u2192]";

      let clean = stripMarkdown(text);

      // Übung-/Karte-Header am Anfang entfernen, damit nur noch das
      // reine Frage/Antwort-Paar übrig bleibt.
      clean = clean.replace(
        /^\s*(?:Übung|Ubung|Uebung|Exercise|Ejercicio|Flashcard|Karteikarte|Karte|Tarjeta|Card|Aufgabe)\s*\d*\s*[:\-).\u2013\u2014]?\s*/i,
        ""
      ).trim();

      // Reine Nummerierung am Zeilenanfang wegwerfen: „1.", „1)", „(1)".
      clean = clean.replace(/^\s*\(?\d+\)?\s*[:.)\-\u2013\u2014]\s*/, "").trim();

      // 1. Standardformat: „Frage: … Antwort: …"
      const qPattern = new RegExp(
        `${KEYS.question}\\s*\\d*\\s*${SEP}\\s*([\\s\\S]+?)(?=\\n\\s*(?:${KEYS.answer}|${KEYS.question})|$)`,
        "i"
      );
      const aPattern = new RegExp(
        `${KEYS.answer}\\s*\\d*\\s*${SEP}\\s*([\\s\\S]+?)(?=\\n\\s*(?:${KEYS.question}|${KEYS.answer})|$)`,
        "i"
      );

      let question = clean.match(qPattern)?.[1]?.trim() || null;
      let answer = clean.match(aPattern)?.[1]?.trim() || null;

      // 2. Nur „Antwort:" vorhanden, Frage steht unmarkiert davor.
      if (!question && answer) {
        const answerStart = clean.search(
          new RegExp(`${KEYS.answer}\\s*\\d*\\s*${SEP}`, "i")
        );
        if (answerStart > 0) {
          question = clean.slice(0, answerStart).trim();
        }
      }

      // 3. Kurzform „Q: … A: …" oder „F: … A: …".
      if (!question) {
        question = clean.match(new RegExp(
          `(?:^|\\n)\\s*(?:Q|F|P)\\s*\\d*\\s*${SEP}\\s*([^\\n]+)`,
          "i"
        ))?.[1]?.trim() || null;
      }
      if (!answer) {
        answer = clean.match(new RegExp(
          `(?:^|\\n)\\s*(?:A|R)\\s*\\d*\\s*${SEP}\\s*([\\s\\S]+?)(?=\\n\\s*(?:Q|F|P|A|R)\\s*\\d*\\s*${SEP}|$)`,
          "i"
        ))?.[1]?.trim() || null;
      }

      // 4. Zeilenbasiert: erste nichtleere Zeile = Frage, Rest = Antwort.
      if (!question || !answer) {
        const lines = clean.split(/\n+/).map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          if (!question) {
            question = lines[0].replace(
              /^(?:Frage|Question|Pregunta|Q|F|P)\s*\d*\s*[:\-\u2013\u2014]\s*/i,
              ""
            ).trim();
          }
          if (!answer) {
            answer = lines.slice(1).join(" ").replace(
              /^(?:Antwort|Answer|Respuesta|A|R)\s*\d*\s*[:\-\u2013\u2014]\s*/i,
              ""
            ).trim();
          }
        }
      }

      // 5. Einzeiliger Fall: alles auf einer Zeile mit „?" in der Mitte.
      //    Vor dem Fragezeichen = Frage, danach = Antwort.
      if ((!question || !answer) && clean && !clean.includes("\n")) {
        const qMarkMatch = clean.match(/^(.*?[?¿])\s+(.+)$/);
        if (qMarkMatch) {
          if (!question) question = qMarkMatch[1].trim();
          if (!answer) answer = qMarkMatch[2].trim();
        }
      }

      // Falls die Frage auf einer Zeile mit der Antwort stand
      // („Frage: X? Antwort: Y."), die Antwort aus der Frage schneiden.
      if (question) {
        question = question.replace(
          new RegExp(`\\s*${KEYS.answer}\\s*\\d*\\s*${SEP}[\\s\\S]*$`, "i"),
          ""
        ).trim();
      }

      if (!question || !answer) {
        throw new Error("Antwort folgt nicht dem Format 'Frage/Question/Pregunta: … / Antwort/Answer/Respuesta: …'.");
      }
      if (question.length < 5 || answer.length < 5) {
        throw new Error("Frage oder Antwort ist zu kurz.");
      }

      return [{ question, answer }];
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
`Übung <nr>:
Frage: <deine Frage>
A: <Antwort A>
B: <Antwort B>
C: <Antwort C>
D: <Antwort D>
Richtig: <A, B, C oder D>
Erklärung: <kurze fachliche Begründung>`,
      en:
`Exercise <nr>:
Question: <your question>
A: <answer A>
B: <answer B>
C: <answer C>
D: <answer D>
Correct: <A, B, C or D>
Explanation: <short academic justification>`,
      es:
`Ejercicio <nr>:
Pregunta: <tu pregunta>
A: <respuesta A>
B: <respuesta B>
C: <respuesta C>
D: <respuesta D>
Correcta: <A, B, C o D>
Explicación: <breve justificación académica>`
    },
    example: {
      de:
`Übung 1:
Frage: Welche Tonarten verwendet der Gregorianische Choral?
A: Dur und Moll
B: Die acht Kirchentonarten
C: Pentatonik
D: Ganztonleiter
Richtig: B
Erklärung: Der Gregorianische Choral folgt den acht Kirchentonarten (Modi), nicht dem Dur-Moll-System.`,
      en:
`Exercise 1:
Question: Which tonal system does Gregorian chant use?
A: Major and minor keys
B: The eight church modes
C: Pentatonic scales
D: Whole-tone scales
Correct: B
Explanation: Gregorian chant follows the eight church modes, not the later major/minor system.`,
      es:
`Ejercicio 1:
Pregunta: ¿Qué sistema tonal utiliza el canto gregoriano?
A: Tonalidad mayor y menor
B: Los ocho modos eclesiásticos
C: Escalas pentatónicas
D: Escalas de tonos enteros
Correcta: B
Explicación: El canto gregoriano sigue los ocho modos eclesiásticos, no el sistema mayor/menor posterior.`
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
`Übung <nr>:
Satz: <satz mit {{LUECKE}} für jede Lücke>
Lösungen: <lösung 1>; <lösung 2>; ...
Erklärung: <kurze fachliche Erklärung>`,
      en:
`Exercise <nr>:
Sentence: <sentence with {{LUECKE}} for each blank>
Solutions: <solution 1>; <solution 2>; ...
Explanation: <short academic explanation>`,
      es:
`Ejercicio <nr>:
Oración: <oración con {{LUECKE}} para cada hueco>
Soluciones: <solución 1>; <solución 2>; ...
Explicación: <breve explicación académica>`
    },
    example: {
      de:
`Übung 1:
Satz: Der Gregorianische Choral entstand im {{LUECKE}} Jahrhundert, ist {{LUECKE}} und {{LUECKE}}, folgt den acht {{LUECKE}} und wird vorwiegend in {{LUECKE}} notiert.
Lösungen: 8.; einstimmig; unbegleitet; Kirchentonarten; Neumen
Erklärung: Der Gregorianische Choral geht auf das 8. Jahrhundert zurück, ist monodisch (einstimmig und unbegleitet), basiert auf den acht Kirchentonarten (Modi) und wurde ursprünglich in Neumen notiert.`,
      en:
`Exercise 1:
Sentence: Gregorian chant emerged in the {{LUECKE}} century, is {{LUECKE}} and {{LUECKE}}, follows the eight {{LUECKE}} and was originally notated in {{LUECKE}}.
Solutions: 8th; monophonic; unaccompanied; church modes; neumes
Explanation: Gregorian chant dates back to the 8th century, is monodic (monophonic and unaccompanied), based on the eight church modes and was originally notated in neumes.`,
      es:
`Ejercicio 1:
Oración: El canto gregoriano surgió en el siglo {{LUECKE}}, es {{LUECKE}} y {{LUECKE}}, sigue los ocho {{LUECKE}} y originalmente se notaba en {{LUECKE}}.
Soluciones: VIII; monódico; sin acompañamiento; modos eclesiásticos; neumas
Explicación: El canto gregoriano surge en el siglo VIII, es monódico y sin acompañamiento, se basa en los ocho modos eclesiásticos y originalmente se notaba en neumas.`
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
 * Holt wissenschaftliche Abstracts aus OpenAlex – einer freien
 * Datenbank mit über 250 Mio. begutachteten Fachartikeln (Nature,
 * Science, Springer, Wiley, universitäre Zeitschriften …).
 *
 * Keine API-Keys, CORS-freundlich, von Universitäten gepflegt.
 * https://docs.openalex.org/
 */
async function fetchOpenAlexContext(topic, language = "de") {
  const query = String(topic || "").trim();
  if (!query) return null;

  const lang = pickLang(language);

  // Nach Relevanz sortiert, nur die 3 wichtigsten Werke.
  const url =
    "https://api.openalex.org/works" +
    "?search=" + encodeURIComponent(query) +
    "&per-page=3" +
    "&sort=relevance_score:desc" +
    "&select=title,abstract_inverted_index,authorships,publication_year,doi,primary_location,open_access";

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const works = Array.isArray(data?.results) ? data.results : [];
    if (!works.length) return null;

    const label = {
      de: "[Fachliteratur] OpenAlex",
      en: "[Academic source] OpenAlex",
      es: "[Literatura académica] OpenAlex"
    }[lang];

    const summaries = [];

    for (const work of works) {
      const title = String(work?.title || "").trim();
      if (!title) continue;

      const year = work?.publication_year || "";
      const firstAuthor = work?.authorships?.[0]?.author?.display_name || "";
      const journal =
        work?.primary_location?.source?.display_name || "";
      const doi = work?.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//, "") : "";

      // OpenAlex liefert Abstracts als „inverted index" (Wort → Positionen).
      // Wir rekonstruieren den Fließtext daraus.
      const abstract = reconstructAbstract(work?.abstract_inverted_index);
      if (!abstract || abstract.length < 60) continue;

      const header =
        [firstAuthor, year ? `(${year})` : "", journal]
          .filter(Boolean)
          .join(" ");

      const entry =
        (header ? header + ":\n" : "") +
        title +
        "\n" +
        abstract.slice(0, 320) +
        (doi ? `\n[DOI: ${doi}]` : "");

      summaries.push(entry);
      if (summaries.join("\n\n").length > 650) break;
    }

    if (!summaries.length) return null;

    return {
      title: `${label}: ${query}`,
      content: summaries.join("\n\n").slice(0, 800),
      sourceType: "academic"
    };
  } catch (error) {
    console.warn("ATELIER AI: OpenAlex-Abruf fehlgeschlagen:", error);
    return null;
  }
}

/**
 * OpenAlex liefert Abstracts als „inverted index":
 * { "wort": [position, position, ...], ... }
 * Wir setzen daraus den originalen Fließtext zusammen.
 */
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";

  const positions = [];
  for (const [word, posList] of Object.entries(invertedIndex)) {
    if (!Array.isArray(posList)) continue;
    for (const pos of posList) {
      positions.push({ pos, word });
    }
  }

  return positions
    .sort((a, b) => a.pos - b.pos)
    .map(entry => entry.word)
    .join(" ");
}

/**
 * Rückfall-Quelle: Wikipedia liefert eine Zusammenfassung, falls
 * OpenAlex für das Schulthema nichts Passendes findet (häufig bei
 * sehr allgemeinen oder sehr schulspezifischen Themen).
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
      content: extract.slice(0, 350),
      sourceType: "encyclopedia"
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
 * Holt die beste verfügbare externe Quelle:
 * 1. OpenAlex (begutachtete Fachliteratur) – Primär
 * 2. Wikipedia – Rückfall, falls OpenAlex nichts liefert
 *
 * Dadurch bekommen Übungen echte wissenschaftliche Belege.
 */
async function fetchExternalContext(topic, language = "de") {
  const openAlex = await fetchOpenAlexContext(topic, language);
  if (openAlex) return openAlex;

  const wiki = await fetchWikipediaContext(topic, language);
  return wiki;
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

// Beschreibt den geforderten Schwierigkeitsgrad fachdidaktisch. Ohne
// diese Zeile ignorieren kleine Modelle den „level"-Wert komplett.
const LEVEL_RULES = {
  de: {
    grundlegend:
      "Niveau GRUNDLEGEND: Reproduktion & Grundwissen. Begriffe definieren, Jahreszahlen, Personen, Fakten direkt aus dem Material abfragen. Kurze, eindeutige Antworten.",
    mittel:
      "Niveau MITTEL: Anwendung & Transfer. Zusammenhänge erklären, Beispiele einordnen, zwei Aspekte vergleichen, Ursachen und Folgen benennen. Antworten mit 1-2 Fachbegriffen.",
    anspruchsvoll:
      "Niveau ANSPRUCHSVOLL: Analyse, Reflexion und Bewertung. Thesen begründen, Positionen kritisch einordnen, fachliche Entscheidungen abwägen, Methoden oder Modelle anwenden. Antworten enthalten Begründungen und Fachtermini."
  },
  en: {
    grundlegend:
      "Level BASIC: recall and foundational knowledge. Define terms, identify dates, persons, facts straight from the material. Short, unambiguous answers.",
    mittel:
      "Level INTERMEDIATE: application and transfer. Explain relationships, place examples, compare two aspects, name causes and effects. Answers include 1-2 technical terms.",
    anspruchsvoll:
      "Level ADVANCED: analysis, reflection and evaluation. Justify theses, position arguments critically, weigh methodological decisions, apply models. Answers include justification and technical vocabulary."
  },
  es: {
    grundlegend:
      "Nivel BÁSICO: reproducción y conocimientos fundamentales. Definir términos, fechas, personas y hechos directamente del material. Respuestas breves e inequívocas.",
    mittel:
      "Nivel INTERMEDIO: aplicación y transferencia. Explicar relaciones, situar ejemplos, comparar dos aspectos, nombrar causas y consecuencias. Respuestas con 1-2 términos técnicos.",
    anspruchsvoll:
      "Nivel AVANZADO: análisis, reflexión y evaluación. Justificar tesis, posicionar argumentos de forma crítica, ponderar decisiones metodológicas, aplicar modelos. Respuestas con justificación y terminología técnica."
  }
};

// Mindest-Qualitätsanforderung an jede Übung: Rohfakten statt Floskeln.
const QUALITY_RULES = {
  de: "- Jede Antwort enthält mindestens EINEN konkreten Fachinhalt: einen Fachbegriff, einen Namen, eine Jahreszahl, einen Mechanismus, eine Formel oder eine konkrete Zahl. KEINE Floskeln wie 'ist ein zentraler Aspekt' oder 'spielt eine wichtige Rolle'.",
  en: "- Every answer MUST contain at least one concrete fact: a technical term, a name, a year, a mechanism, a formula or a specific number. NO filler like \"is a central aspect\" or \"plays an important role\".",
  es: "- Cada respuesta DEBE contener al menos un hecho concreto: un término técnico, un nombre, una fecha, un mecanismo, una fórmula o un número específico. SIN muletillas como \"es un aspecto central\" o \"desempeña un papel importante\"."
};

// Format-spezifische Zusatzregeln (Lücken-Anzahl, Mehrfach-Fragen …).
const FORMAT_EXTRA_RULES = {
  flashcards: {
    de: "- Fragen sind spezifisch (W-Fragen oder gezielte Entscheidungsfragen), nicht generisch. Antworten sind maximal 2 Sätze, aber inhaltlich reichhaltig.",
    en: "- Questions are specific (wh-questions or targeted decision questions), never generic. Answers are at most 2 sentences but rich in content.",
    es: "- Las preguntas son específicas (interrogativas o preguntas de decisión concretas), nunca genéricas. Las respuestas tienen como máximo 2 oraciones pero son ricas en contenido."
  },
  multipleChoice: {
    de: "- Alle vier Antwortmöglichkeiten sind FACHLICH plausibel – auch die falschen Alternativen stammen aus dem gleichen Themenfeld und wirken auf den ersten Blick möglich. Keine offensichtlich sinnlosen Distraktoren.\n- Die Erklärung begründet, warum die richtige Antwort stimmt UND warum die wichtigste falsche Alternative nicht stimmt.",
    en: "- All four options are technically PLAUSIBLE – even the wrong ones belong to the same subject domain and look possible at first glance. No obviously nonsensical distractors.\n- The explanation argues why the correct option is right AND why the strongest wrong alternative is incorrect.",
    es: "- Las cuatro opciones son TÉCNICAMENTE plausibles – incluso las incorrectas pertenecen al mismo campo temático y parecen posibles a primera vista. Sin distractores evidentemente absurdos.\n- La explicación argumenta por qué la opción correcta es correcta Y por qué la alternativa incorrecta más fuerte no lo es."
  },
  cloze: {
    de: "- Jeder Satz enthält GENAU 3 bis 5 Lücken {{LUECKE}}. Die Lücken müssen echte Fachbegriffe, Zahlen, Namen oder Mechanismen sein, keine Allerwelts-Wörter wie 'ist' oder 'wird'.\n- Die Reihenfolge der Lösungen entspricht der Reihenfolge der Lücken im Satz.",
    en: "- Every sentence contains EXACTLY 3 to 5 blanks {{LUECKE}}. Blanks must be real technical terms, numbers, names or mechanisms – never generic words like 'is' or 'has'.\n- The order of the solutions matches the order of the blanks in the sentence.",
    es: "- Cada oración contiene EXACTAMENTE 3 a 5 huecos {{LUECKE}}. Los huecos deben ser términos técnicos reales, números, nombres o mecanismos – nunca palabras genéricas como 'es' o 'tiene'.\n- El orden de las soluciones coincide con el orden de los huecos en la oración."
  }
};

/**
 * Fachspezifische Few-Shot-Beispiele.
 *
 * Hintergrund: kleine Modelle kopieren bei Few-Shot-Prompting gerne den
 * konkreten Inhalt des Beispiels – ein Choral-Beispiel führte zu
 * Choral-Antworten auch bei Mathematik-Fragen. Deshalb liefern wir für
 * jedes Schulfach ein eigenes, authentisches Beispiel.
 *
 * Deutsch ist Standard; Englisch und Spanisch sind nur für die
 * sprachlehrenden Fächer (die ihrerseits in der jeweiligen Sprache
 * antworten) als separate Beispiele hinterlegt.
 */
const SUBJECT_EXAMPLES = {
  Mathematik: {
    flashcards: `Übung 1:
Frage: Wie lautet die Ableitung von f(x) = x^n für n ∈ ℝ?
Antwort: Nach der Potenzregel gilt f'(x) = n · x^(n-1).

Übung 2:
Frage: Was besagt der Mittelwertsatz der Differentialrechnung?
Antwort: Für jede auf [a,b] stetige und auf (a,b) differenzierbare Funktion existiert ein c ∈ (a,b) mit f'(c) = (f(b)-f(a))/(b-a).`,
    multipleChoice: `Übung 1:
Frage: Welche Ableitung hat f(x) = sin(x)?
A: -cos(x)
B: cos(x)
C: -sin(x)
D: tan(x)
Richtig: B
Erklärung: Es gilt (sin x)' = cos(x). -cos(x) wäre die Ableitung von cos(x), nicht von sin(x); -sin(x) ist die Ableitung von cos(x).`,
    cloze: `Übung 1:
Satz: Eine Funktion f ist in x₀ differenzierbar, wenn der {{LUECKE}} existiert; die Ableitung gibt die {{LUECKE}} der Tangente an und ihr Vorzeichen bestimmt das {{LUECKE}} des Graphen.
Lösungen: Grenzwert des Differenzenquotienten; Steigung; Monotonieverhalten
Erklärung: Differenzierbarkeit bedeutet die Existenz des Grenzwerts des Differenzenquotienten; die Ableitung ist die Steigung der Tangente und beschreibt die Monotonie.`
  },
  Deutsch: {
    flashcards: `Übung 1:
Frage: Welche drei Merkmale kennzeichnen die literarische Moderne (ca. 1890-1920)?
Antwort: Ich-Zerfall, Sprachskepsis und Pluralismus der Stile (u. a. Expressionismus, Symbolismus, Dadaismus).

Übung 2:
Frage: Was unterscheidet eine Metapher von einem Vergleich?
Antwort: Die Metapher setzt zwei Bildbereiche ohne Vergleichspartikel gleich; der Vergleich verknüpft sie explizit mit 'wie' oder 'als'.`,
    multipleChoice: `Übung 1:
Frage: Welches Stilmittel liegt im Satz 'Die Flamme der Hoffnung erlosch' vor?
A: Metonymie
B: Metapher
C: Hyperbel
D: Anapher
Richtig: B
Erklärung: 'Flamme der Hoffnung' überträgt ein Bild (Feuer) auf einen abstrakten Begriff (Hoffnung) ohne 'wie' – das ist eine Metapher. Metonymie würde den Begriff durch einen eng verwandten ersetzen.`,
    cloze: `Übung 1:
Satz: Ein Drama nach Freytag gliedert sich in {{LUECKE}}, {{LUECKE}}, Höhepunkt, {{LUECKE}} und {{LUECKE}}.
Lösungen: Exposition; steigende Handlung; retardierendes Moment; Katastrophe
Erklärung: Freytags Pyramide beschreibt den klassischen Fünfakter: Exposition, steigende Handlung, Höhepunkt mit Peripetie, retardierendes Moment, Katastrophe.`
  },
  Geographie: {
    flashcards: `Übung 1:
Frage: Was bezeichnet man als Innertropische Konvergenzzone (ITC)?
Antwort: Den Tiefdruckgürtel am thermischen Äquator, in dem Nordost- und Südostpassate zusammentreffen und Zenitalregen auslösen.

Übung 2:
Frage: Welche drei Prozesse treiben die Plattenbewegung an?
Antwort: Konvektionsströme im Erdmantel, Ridge Push an mittelozeanischen Rücken und Slab Pull an Subduktionszonen.`,
    multipleChoice: `Übung 1:
Frage: Welcher Faktor erklärt die Entstehung von Monsunwinden am stärksten?
A: Corioliskraft
B: Druckunterschied zwischen erwärmtem Festland und kühlerem Ozean
C: Golfstrom
D: Jetstream
Richtig: B
Erklärung: Monsune entstehen durch jahreszeitlich wechselnde Druckgradienten zwischen Festland und Ozean. Die Corioliskraft lenkt die Winde nur ab, erzeugt sie aber nicht.`,
    cloze: `Übung 1:
Satz: In humiden Mittelbreiten entstehen Böden vom Typ {{LUECKE}}, in semiariden Steppen dominiert der {{LUECKE}}, und in den feuchten Tropen bildet sich der nährstoffarme {{LUECKE}}.
Lösungen: Braunerde; Tschernosem; Latosol
Erklärung: Braunerde ist typisch für humide Mittelbreiten, Tschernosem für Steppen, Latosol für feuchttropische Verwitterung.`
  },
  Chemie: {
    flashcards: `Übung 1:
Frage: Wie lautet die allgemeine Reaktionsgleichung einer Veresterung?
Antwort: Carbonsäure + Alkohol ⇌ Ester + Wasser (säurekatalysiert, Gleichgewichtsreaktion).

Übung 2:
Frage: Was besagt das Prinzip von Le Chatelier?
Antwort: Ein chemisches Gleichgewicht weicht einer äußeren Störung (Druck, Temperatur, Konzentration) so aus, dass die Störung minimiert wird.`,
    multipleChoice: `Übung 1:
Frage: Welche Hybridisierung liegt am Kohlenstoff in Ethen (C₂H₄) vor?
A: sp
B: sp²
C: sp³
D: sp³d
Richtig: B
Erklärung: Ethen hat eine C=C-Doppelbindung, also drei σ-Bindungen pro C-Atom – das entspricht sp²-Hybridisierung. sp³ läge bei vier Einfachbindungen vor.`,
    cloze: `Übung 1:
Satz: Eine Säure ist nach {{LUECKE}} ein {{LUECKE}}-Donator, der mit Wasser {{LUECKE}}-Ionen bildet; die Stärke wird mit dem {{LUECKE}}-Wert ausgedrückt.
Lösungen: Brønsted; Protonen; Oxonium; pKs
Erklärung: Nach Brønsted ist eine Säure ein Protonendonator; sie bildet mit Wasser H₃O⁺-Ionen, die Säurestärke wird durch den pKs-Wert quantifiziert.`
  },
  Musik: {
    flashcards: `Übung 1:
Frage: Welche Rolle spielt der Choral im Gregorianischen Repertoire?
Antwort: Er bildet die liturgische Grundform – einstimmig, unbegleitet und in den acht Kirchentonarten notiert.

Übung 2:
Frage: Wodurch unterscheidet sich eine Fuge formal vom Kanon?
Antwort: Die Fuge verarbeitet ein Thema in mehreren Stimmen mit Dux, Comes und Zwischenspielen; der Kanon wiederholt die Melodie identisch, nur zeitlich versetzt.`,
    multipleChoice: `Übung 1:
Frage: Welche Tonalität verwendet der Gregorianische Choral?
A: Dur und Moll
B: Die acht Kirchentonarten
C: Pentatonik
D: Zwölftontechnik
Richtig: B
Erklärung: Der Gregorianische Choral folgt den acht Kirchentonarten (Dorisch, Phrygisch, Lydisch, Mixolydisch jeweils authentisch und plagal). Dur/Moll setzt sich erst ab dem 17. Jahrhundert durch.`,
    cloze: `Übung 1:
Satz: Die Sonatenhauptsatzform gliedert sich in {{LUECKE}}, {{LUECKE}} und {{LUECKE}}; das Hauptthema erscheint in der Tonika, das Seitenthema zuerst in der {{LUECKE}}.
Lösungen: Exposition; Durchführung; Reprise; Dominante
Erklärung: Die klassische Sonatenhauptsatzform besteht aus Exposition, Durchführung und Reprise; das Seitenthema steht in der Dominanttonart (bei Durwerken) bzw. der parallelen Durtonart (bei Mollwerken).`
  },
  Sport: {
    flashcards: `Übung 1:
Frage: Welche drei Energiesysteme stehen dem Muskel bei Belastung zur Verfügung?
Antwort: Das anaerob-alaktazide (ATP/Kreatinphosphat), das anaerob-laktazide (Glykolyse mit Laktat) und das aerobe System (oxidative Phosphorylierung).

Übung 2:
Frage: Was unterscheidet Maximalkraft von Schnellkraft?
Antwort: Maximalkraft ist die höchste willkürlich erzeugbare Kraft; Schnellkraft ist die Fähigkeit, in kürzester Zeit einen hohen Kraftanstieg zu erreichen (Explosivkraft).`,
    multipleChoice: `Übung 1:
Frage: Welches Energiesystem dominiert bei einem 100-m-Sprint?
A: Aerobe Phosphorylierung
B: Anaerob-alaktazide ATP-Spaltung
C: Fettsäureoxidation
D: Krebs-Zyklus
Richtig: B
Erklärung: In den ersten 8-10 Sekunden maximaler Belastung liefert das anaerob-alaktazide System über die Spaltung von ATP und Kreatinphosphat die Energie. Aerobe Prozesse brauchen deutlich länger.`,
    cloze: `Übung 1:
Satz: Die aerobe Ausdauer wird durch die {{LUECKE}} begrenzt; Trainingsmethoden sind die {{LUECKE}}, die {{LUECKE}} und die {{LUECKE}}.
Lösungen: maximale Sauerstoffaufnahme (VO₂max); Dauermethode; extensive Intervallmethode; Fahrtspiel
Erklärung: Die VO₂max setzt die Obergrenze aerober Leistungsfähigkeit; Dauer-, Intervall- und Fahrtspielmethode sind etablierte Trainingsformen zur Verbesserung.`
  },
  "Evangelische Religion": {
    flashcards: `Übung 1:
Frage: Was besagt Luthers Rechtfertigungslehre?
Antwort: Der Mensch wird 'sola gratia, sola fide' – allein aus Gnade und durch den Glauben – gerecht, nicht durch eigene Werke.

Übung 2:
Frage: Welche vier 'solae' prägen die reformatorische Theologie?
Antwort: Sola scriptura (allein die Schrift), sola gratia (allein die Gnade), sola fide (allein der Glaube), solus Christus (allein Christus).`,
    multipleChoice: `Übung 1:
Frage: Welche theologische Grundidee markiert Luthers 95 Thesen von 1517?
A: Ablehnung der Trinität
B: Kritik am Ablasshandel und Betonung der Buße
C: Einführung des Zölibats
D: Trennung von Kirche und Staat
Richtig: B
Erklärung: Die 95 Thesen richten sich gegen den Ablasshandel und fordern innerliche Buße. Trennung von Kirche und Staat ist eine spätere säkulare Entwicklung.`,
    cloze: `Übung 1:
Satz: Nach Bonhoeffer ist 'billige Gnade' die {{LUECKE}} ohne {{LUECKE}}, während 'teure Gnade' Christus {{LUECKE}} und zur {{LUECKE}} ruft.
Lösungen: Rechtfertigung; Nachfolge; nachfolgt; Jüngerschaft
Erklärung: Bonhoeffer kontrastiert in 'Nachfolge' (1937) billige Gnade (Rechtfertigung ohne Nachfolge) mit teurer Gnade, die zur Jüngerschaft verpflichtet.`
  },
  Biologie: {
    flashcards: `Übung 1:
Frage: Welche beiden Phasen umfasst die Photosynthese?
Antwort: Die Lichtreaktion (Thylakoide, ATP + NADPH + O₂) und die Dunkelreaktion / Calvin-Zyklus (Stroma, CO₂-Fixierung zu Glucose).

Übung 2:
Frage: Was unterscheidet die DNA-Replikation vom Transkriptionsprozess?
Antwort: Replikation kopiert die gesamte DNA zu zwei identischen Tochtersträngen (DNA-Polymerase); Transkription überträgt einen DNA-Abschnitt in eine mRNA (RNA-Polymerase).`,
    multipleChoice: `Übung 1:
Frage: An welcher Zellstruktur findet die oxidative Phosphorylierung statt?
A: Zellkern
B: Raues ER
C: Innere Mitochondrienmembran
D: Golgi-Apparat
Richtig: C
Erklärung: Die ATP-Synthese über die Atmungskette läuft an der inneren Mitochondrienmembran ab. Der Zellkern beherbergt die DNA, am rauen ER erfolgt die Proteinsynthese.`,
    cloze: `Übung 1:
Satz: Die Enzymkinetik nach Michaelis-Menten beschreibt den {{LUECKE}} über die Konstante {{LUECKE}} und die maximale {{LUECKE}}; am {{LUECKE}} des Enzyms bindet das Substrat.
Lösungen: Reaktionsverlauf; KM; Reaktionsgeschwindigkeit vmax; aktiven Zentrum
Erklärung: Michaelis-Menten erklärt enzymatische Reaktionsgeschwindigkeiten durch KM (Substratkonzentration bei halbmaximaler Geschwindigkeit) und vmax; die Katalyse findet am aktiven Zentrum statt.`
  },
  "Politik und Gesellschaft": {
    flashcards: `Übung 1:
Frage: Welche fünf Verfassungsprinzipien nennt Art. 20 GG?
Antwort: Demokratie, Rechtsstaat, Sozialstaat, Bundesstaat (Föderalismus) und Republik.

Übung 2:
Frage: Was bedeutet das Subsidiaritätsprinzip in der EU?
Antwort: Die EU wird nur tätig, wenn ein Ziel auf nationaler, regionaler oder lokaler Ebene nicht ausreichend erreicht werden kann (Art. 5 EUV).`,
    multipleChoice: `Übung 1:
Frage: Welche Institution der Bundesrepublik hat das alleinige Recht, Gesetze verfassungsrechtlich zu überprüfen?
A: Bundestag
B: Bundesregierung
C: Bundesverfassungsgericht
D: Bundesrat
Richtig: C
Erklärung: Nach Art. 93 GG ist das Bundesverfassungsgericht für die Normenkontrolle zuständig. Der Bundestag erlässt Gesetze, überprüft sie aber nicht auf Verfassungsmäßigkeit.`,
    cloze: `Übung 1:
Satz: Das Grundgesetz schützt die {{LUECKE}} in Art. 1, bindet alle staatliche Gewalt an die {{LUECKE}} (Art. 20 III) und verlangt eine Rechtfertigung jedes Eingriffs über das {{LUECKE}}sprinzip.
Lösungen: Menschenwürde; Verfassung und Gesetze; Verhältnismäßigkeit
Erklärung: Art. 1 GG schützt die Menschenwürde unantastbar; Art. 20 III bindet staatliches Handeln an Verfassung und Gesetz; das Verhältnismäßigkeitsprinzip verlangt Eignung, Erforderlichkeit und Angemessenheit jeden Grundrechtseingriffs.`
  },
  Geschichte: {
    flashcards: `Übung 1:
Frage: Welche vier Ursachenkomplexe nennt die Forschung für den Ausbruch des Ersten Weltkriegs?
Antwort: Imperialismus, Bündnissystem (Entente/Dreibund), Wettrüsten, Nationalismus mit Krisenherd Balkan (Juli-Krise 1914).

Übung 2:
Frage: Was besagt die Fischer-These zur Kriegsschuldfrage 1914?
Antwort: Fritz Fischer (1961) sah im Deutschen Reich den Hauptverursacher: Weltmachtstreben und Kriegsabsichten als wesentliche Ursache des Ersten Weltkriegs.`,
    multipleChoice: `Übung 1:
Frage: Welches Ereignis gilt als Beginn der Französischen Revolution?
A: Ermordung Marats 1793
B: Sturm auf die Bastille am 14. Juli 1789
C: Hinrichtung Ludwigs XVI. 1793
D: Krönung Napoleons 1804
Richtig: B
Erklärung: Der Sturm auf die Bastille am 14. Juli 1789 markiert den symbolischen Beginn der Revolution. Hinrichtung und Marat-Ermordung sind spätere Ereignisse der Jakobinerherrschaft.`,
    cloze: `Übung 1:
Satz: Der Versailler Vertrag von {{LUECKE}} verpflichtete das Deutsche Reich zur {{LUECKE}}, zu Reparationen und zur Abtretung von {{LUECKE}}; der Artikel {{LUECKE}} legte die alleinige Kriegsschuld fest.
Lösungen: 1919; Entmilitarisierung; Elsass-Lothringen; 231
Erklärung: Der Vertrag wurde 1919 unterzeichnet, verpflichtete zur Entmilitarisierung, forderte u. a. die Rückgabe Elsass-Lothringens an Frankreich und schrieb mit Art. 231 die alleinige deutsche Kriegsschuld fest.`
  }
};

// Fachspezifische Beispiele für fremdsprachliche Fächer (Antwortsprache
// ist dann die Zielsprache). Englisch-Beispiele zu englischer Grammatik,
// Spanisch zu spanischer Grammatik – damit das Beispiel inhaltlich zum
// Sprachunterricht passt.
const SUBJECT_EXAMPLES_EN = {
  Englisch: {
    flashcards: `Exercise 1:
Question: What distinguishes the present perfect from the simple past in English?
Answer: Present perfect links a past action to the present (unspecified time), while simple past describes a completed action at a specific past time.

Exercise 2:
Question: Which stylistic device dominates in Shakespeare's "Shall I compare thee to a summer's day"?
Answer: The extended metaphor (conceit), comparing the beloved to summer across the entire sonnet.`,
    multipleChoice: `Exercise 1:
Question: Which tense is used in: "By 2030, scientists will have discovered a cure."?
A: Simple future
B: Future continuous
C: Future perfect
D: Present perfect
Correct: C
Explanation: "will have + past participle" is the future perfect, used for actions completed before a point in the future. Simple future would be "will discover".`,
    cloze: `Exercise 1:
Sentence: A sonnet by Shakespeare consists of {{LUECKE}} lines in {{LUECKE}} and follows the rhyme scheme {{LUECKE}}, ending with a {{LUECKE}}.
Solutions: 14; iambic pentameter; ABAB CDCD EFEF GG; rhymed couplet
Explanation: A Shakespearean sonnet has 14 lines in iambic pentameter, follows the ABAB CDCD EFEF GG rhyme scheme and closes with a rhymed couplet.`
  }
};

const SUBJECT_EXAMPLES_ES = {
  Spanisch: {
    flashcards: `Ejercicio 1:
Pregunta: ¿Qué diferencia hay entre el pretérito indefinido y el pretérito imperfecto en español?
Respuesta: El indefinido describe acciones puntuales terminadas en el pasado; el imperfecto expresa acciones habituales o descripciones de fondo sin un final definido.

Ejercicio 2:
Pregunta: ¿Qué figura retórica predomina en el poema "Caminante, no hay camino" de Antonio Machado?
Respuesta: La metáfora extendida: la vida como camino que se construye al andar, con uso de paralelismo y anáfora.`,
    multipleChoice: `Ejercicio 1:
Pregunta: ¿Qué modo verbal exige la expresión "No creo que ... la verdad"?
A: Indicativo
B: Subjuntivo
C: Imperativo
D: Condicional
Correcta: B
Explicación: Expresiones de duda o negación de una opinión ("no creo que") rigen subjuntivo. El indicativo aparecería tras "creo que ...".`,
    cloze: `Ejercicio 1:
Oración: El Siglo de Oro español abarca los siglos {{LUECKE}}, con autores como {{LUECKE}} (teatro), {{LUECKE}} (novela picaresca) y {{LUECKE}} (poesía mística).
Soluciones: XVI y XVII; Lope de Vega; Francisco de Quevedo; San Juan de la Cruz
Explicación: El Siglo de Oro cubre los siglos XVI y XVII; Lope de Vega renovó el teatro, Quevedo cultivó la picaresca y San Juan de la Cruz la poesía mística.`
  }
};

const KNOWLEDGE_RULES = {
  de: {
    withMaterials:
      "- Jede Übung MUSS auf einem KONKRETEN Begriff, Satz oder Fakt aus den ARBEITSMATERIALIEN basieren – also aus den Unterrichtsmaterialien der Schülerin. Erfinde KEINE neuen Fakten.\n" +
      "- Streue die Übungen über das Material: wähle für jede Übung einen ANDEREN Abschnitt oder Begriff. Keine zwei Übungen zum selben Teilaspekt.\n" +
      "- Nutze die externe Fachliteratur nur zur Vertiefung oder zur Formulierung, nicht als Hauptquelle.",
    withoutMaterials:
      "- Nutze dein gesichertes Oberstufen-Fachwissen zum Thema.\n" +
      "- Jede Übung behandelt einen ANDEREN Teilaspekt – keine inhaltlichen Doppelungen."
  },
  en: {
    withMaterials:
      "- Every exercise MUST be based on a CONCRETE term, sentence or fact from the WORKING MATERIAL – i.e. the student's class notes. Do NOT invent new facts.\n" +
      "- Spread the exercises across the material: pick a DIFFERENT section or term for each exercise. No two exercises on the same sub-aspect.\n" +
      "- Use the external academic source only for depth or wording, not as the main source.",
    withoutMaterials:
      "- Draw on your reliable upper-school knowledge of the topic.\n" +
      "- Each exercise must cover a DIFFERENT sub-aspect – no content repetition."
  },
  es: {
    withMaterials:
      "- Cada ejercicio DEBE basarse en un término, frase o hecho CONCRETO del MATERIAL DE TRABAJO – es decir, los apuntes de clase de la alumna. NO inventes hechos nuevos.\n" +
      "- Reparte los ejercicios sobre el material: elige una sección o término DIFERENTE para cada ejercicio. Nunca dos ejercicios sobre el mismo subaspecto.\n" +
      "- Usa la fuente académica externa solo para profundizar o para la redacción, no como fuente principal.",
    withoutMaterials:
      "- Basa la respuesta en tus conocimientos sólidos de bachillerato sobre el tema.\n" +
      "- Cada ejercicio debe tratar un subaspecto DIFERENTE – sin repeticiones."
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

  // Fachspezifisches Few-Shot-Beispiel wählen. Zwischenergebnis vorher:
  // ein Choral-Beispiel führte zu Choral-Antworten in Mathematik.
  // Deshalb jetzt pro Fach ein eigenes Beispiel; nur wenn ein Fach
  // nicht erfasst ist, fällt die Logik auf das generische Beispiel in
  // FORMATS[format].example zurück.
  const subjectPool = lang === "en"
    ? SUBJECT_EXAMPLES_EN
    : lang === "es"
      ? SUBJECT_EXAMPLES_ES
      : SUBJECT_EXAMPLES;

  const example =
    subjectPool?.[subject]?.[format]
    || formatConfig.example?.[lang]
    || "";

  const mcLine = format === "multipleChoice"
    ? "\n" + MC_RULES[lang]
    : "";

  const levelKey = LEVEL_RULES[lang][level] ? level : "grundlegend";
  const levelRule = "- " + LEVEL_RULES[lang][levelKey];
  const qualityRule = QUALITY_RULES[lang];
  const formatExtraRule = FORMAT_EXTRA_RULES[format][lang];

  // Format-spezifische Pflichtzeilen. Für kleine Modelle entscheidend:
  // „jede Übung besteht aus genau folgenden Zeilen" lässt sie
  // zuverlässiger das Template befolgen.
  const formatSpecificRule = {
    flashcards: {
      de: "Jede Übung besteht aus GENAU drei Zeilen: eine Zeile 'Übung N:', eine Zeile 'Frage: ...' (muss mit ? enden), eine Zeile 'Antwort: ...'. KEIN Fließtext, KEINE Prosa ohne diese Labels.",
      en: "Each exercise has EXACTLY three lines: one 'Exercise N:' line, one 'Question: ...' line (must end with '?'), one 'Answer: ...' line. NO running prose without these labels.",
      es: "Cada ejercicio tiene EXACTAMENTE tres líneas: una línea 'Ejercicio N:', una línea 'Pregunta: ...' (debe terminar con '?'), una línea 'Respuesta: ...'. SIN texto corrido sin estas etiquetas."
    },
    multipleChoice: {
      de: "Jede Übung muss die Labels 'Frage:', 'A:', 'B:', 'C:', 'D:', 'Richtig:' und 'Erklärung:' in genau dieser Reihenfolge enthalten.",
      en: "Each exercise must contain the labels 'Question:', 'A:', 'B:', 'C:', 'D:', 'Correct:' and 'Explanation:' in that exact order.",
      es: "Cada ejercicio debe contener las etiquetas 'Pregunta:', 'A:', 'B:', 'C:', 'D:', 'Correcta:' y 'Explicación:' en ese orden exacto."
    },
    cloze: {
      de: "Jede Übung muss die Labels 'Satz:', 'Lösungen:' und 'Erklärung:' enthalten. Verwende {{LUECKE}} als Platzhalter im Satz.",
      en: "Each exercise must contain the labels 'Sentence:', 'Solutions:' and 'Explanation:'. Use {{LUECKE}} as placeholder in the sentence.",
      es: "Cada ejercicio debe contener las etiquetas 'Oración:', 'Soluciones:' y 'Explicación:'. Usa {{LUECKE}} como marcador en la oración."
    }
  }[format][lang];

  const headwords = {
    de: {
      topic: "Thema",
      subject: "Fach",
      task: "Aufgabe",
      count: "Übungen",
      format: "VERWENDE EXAKT DIESES FORMAT:",
      exampleLabel: `BEISPIEL – nur zur FORMATveranschaulichung. Der INHALT des Beispiels ist IRRELEVANT. Deine Übungen behandeln ausschließlich das Thema "${topic}" im Fach ${subject}:`,
      exampleAfter: `ENDE DES BEISPIELS. Vergiss den Inhalt des Beispiels komplett. Dein Thema ist "${topic}" im Fach ${subject} – darüber (und NUR darüber) sollst du Übungen erstellen.`,
      rules: "Regeln",
      ruleLevel: `Oberstufen-Niveau (${level}), fachlich korrekt, auf Deutsch.`,
      ruleFormat: "Keine Einleitung, kein Markdown, keine Codeblöcke, kein Fließtext zwischen den Übungen. Antworte NUR mit den Übungen im Format.",
      ruleTopic: `Jede Übung MUSS inhaltlich zum Thema "${topic}" (Fach: ${subject}) gehören. Keine Übung zu einem anderen Fach oder Thema.`,
      ruleUnique: "Jede Übung behandelt einen ANDEREN Aspekt – keine inhaltlichen Wiederholungen zwischen den Übungen.",
      startCue: `Erzeuge jetzt ${count} verschiedene Übungen zum Thema "${topic}" im Fach ${subject}. Beginne SOFORT mit "Übung 1:".`
    },
    en: {
      topic: "Topic",
      subject: "Subject",
      task: "Task",
      count: "exercises",
      format: "USE EXACTLY THIS FORMAT:",
      exampleLabel: `EXAMPLE – FORMAT illustration only. The CONTENT of the example is IRRELEVANT. Your exercises are strictly about the topic "${topic}" in ${subject}:`,
      exampleAfter: `END OF EXAMPLE. Forget the example content entirely. Your topic is "${topic}" in ${subject} – create exercises about THIS and nothing else.`,
      rules: "Rules",
      ruleLevel: `Upper-school level (${level}), academically correct, in English.`,
      ruleFormat: "No preamble, no markdown, no code blocks, no running text between exercises. Reply ONLY with the exercises in the format.",
      ruleTopic: `Every exercise MUST address the topic "${topic}" (Subject: ${subject}). No exercise about a different subject or topic.`,
      ruleUnique: "Each exercise must cover a DIFFERENT aspect – no content repetitions between exercises.",
      startCue: `Now generate ${count} distinct exercises about "${topic}" in ${subject}. Start IMMEDIATELY with "Exercise 1:".`
    },
    es: {
      topic: "Tema",
      subject: "Asignatura",
      task: "Tarea",
      count: "ejercicios",
      format: "UTILIZA EXACTAMENTE ESTE FORMATO:",
      exampleLabel: `EJEMPLO – solo para ilustrar el FORMATO. El CONTENIDO del ejemplo es IRRELEVANTE. Tus ejercicios tratan únicamente el tema "${topic}" en ${subject}:`,
      exampleAfter: `FIN DEL EJEMPLO. Olvida por completo el contenido del ejemplo. Tu tema es "${topic}" en ${subject} – crea ejercicios SOLO sobre eso.`,
      rules: "Reglas",
      ruleLevel: `Nivel de bachillerato superior (${level}), académicamente correcto, en español.`,
      ruleFormat: "Sin introducción, sin markdown, sin bloques de código, sin texto corrido entre ejercicios. Responde SOLO con los ejercicios en el formato.",
      ruleTopic: `Cada ejercicio DEBE tratar el tema "${topic}" (Asignatura: ${subject}). Ningún ejercicio sobre otra asignatura u otro tema.`,
      ruleUnique: "Cada ejercicio debe tratar un aspecto DIFERENTE – sin repeticiones de contenido entre ejercicios.",
      startCue: `Genera ahora ${count} ejercicios distintos sobre "${topic}" en ${subject}. Empieza INMEDIATAMENTE con "Ejercicio 1:".`
    }
  };

  const h = headwords[lang];

  const instruction = formatConfig.instruction[lang];

  const exampleBlock = example
    ? `\n${h.exampleLabel}\n${example}\n\n${h.exampleAfter}\n`
    : "";

  return `${h.topic}: "${topic}" (${h.subject}: ${subject})

${h.task}: Erstelle genau ${count} ${h.count}. ${instruction}

${h.format}

${singleTemplate}
${exampleBlock}
${h.rules}:
${knowledge}
${levelRule}
${qualityRule}
${formatExtraRule}
- ${formatSpecificRule}
- ${h.ruleLevel}
- ${h.ruleFormat}
- ${h.ruleTopic}
- ${h.ruleUnique}${mcLine}

${h.startCue}`;
}

/**
 * Teilt eine Batch-Antwort in einzelne Übungsblöcke.
 *
 * Mehrstufige Fallback-Strategie, damit auch untypisch formatierte
 * Modell-Antworten noch zerlegt werden können:
 *   1. Explizite Separatoren: „Übung N", „Exercise N", „Ejercicio N",
 *      „Karteikarte N", „Flashcard N", „Tarjeta N", „Karte N", „Card N"
 *   2. Nummerierte Zeilen am Zeilenanfang: „1.", „1)", „(1)"
 *   3. Primär-Schlüssel am Zeilenanfang: „Frage:", „Question:", …
 *   4. Primär-Schlüssel irgendwo im Text (auch nach Nummern o. Markdown)
 */
function splitIntoBlocks(text, primaryKey) {
  const clean = stripMarkdown(text);

  const sliceByIndices = (indices) =>
    indices
      .map((start, i) => {
        const end = i + 1 < indices.length ? indices[i + 1] : clean.length;
        return clean.slice(start, end).trim();
      })
      .filter(section => section.length > 10);

  const collectIndices = (regex) => {
    regex.lastIndex = 0;
    const indices = [];
    let m;
    while ((m = regex.exec(clean)) !== null) {
      indices.push(m.index);
      if (m.index === regex.lastIndex) regex.lastIndex += 1;
    }
    return indices;
  };

  // Stufe 1: explizite Übungs-/Karten-/Aufgaben-Marker
  const sectionRe = /^\s*(?:Übung|Ubung|Uebung|Exercise|Ejercicio|Flashcard|Karteikarte|Karte|Tarjeta|Card|MC|Aufgabe|Pregunta\s+n[uú]mero|Multiple\s*Choice)\s*\d+\s*[:\-).]?.*$/gim;
  let indices = collectIndices(sectionRe);
  if (indices.length >= 2) return sliceByIndices(indices);

  // Stufe 2: nummerierte Zeilen – „1. Frage: …", „1) …", „(1) …"
  const numberedRe = /^\s*(?:\(\s*\d+\s*\)|\d+\s*[.)])\s+(?=\S)/gim;
  indices = collectIndices(numberedRe);
  if (indices.length >= 2) return sliceByIndices(indices);

  // Stufe 3: Primär-Schlüssel am Zeilenanfang
  const primLineRe = new RegExp(
    `^\\s*${primaryKey}\\s*\\d*\\s*[:\\-]`,
    "gim"
  );
  indices = collectIndices(primLineRe);
  if (indices.length >= 2) return sliceByIndices(indices);

  // Stufe 4: Primär-Schlüssel irgendwo (notfalls auch nach Nummern)
  const primAnyRe = new RegExp(
    `(?:^|\\n)\\s*(?:\\(?\\d+\\)?[.)]\\s*)?${primaryKey}\\s*\\d*\\s*[:\\-]`,
    "gi"
  );
  indices = [];
  let m;
  primAnyRe.lastIndex = 0;
  while ((m = primAnyRe.exec(clean)) !== null) {
    // Index auf Beginn des Primär-Schlüssels (nicht den Zeilenumbruch) setzen
    const subMatch = m[0].search(new RegExp(primaryKey, "i"));
    indices.push(m.index + Math.max(0, subMatch));
    if (m.index === primAnyRe.lastIndex) primAnyRe.lastIndex += 1;
  }
  if (indices.length >= 2) return sliceByIndices(indices);

  // Letzter Ausweg: eine einzige Übung in der Antwort – komplett zurückgeben
  return clean.length > 10 ? [clean] : [];
}

/**
 * Letzter Rettungsanker: Wenn Parse+Validate restlos scheitern,
 * baue aus der Rohantwort trotzdem eine brauchbare Übung. Lieber eine
 * imperfekte Karte als die Fehlermeldung „konnte nicht zerlegt werden".
 *
 * Nur für Flashcards sinnvoll – MC und Lückentexte brauchen Struktur,
 * die nicht aus Rohtext rekonstruiert werden kann.
 */
function rescueFromRaw(format, raw) {
  if (format !== "flashcards") return null;

  // Erst Übungs-/Karteikarten-Header am Anfang jedes Blocks entfernen,
  // damit die Rohtext-Analyse auf dem reinen Inhalt arbeitet.
  const stripHeader = (chunk) => chunk
    .replace(
      /^\s*(?:Übung|Ubung|Uebung|Exercise|Ejercicio|Flashcard|Karteikarte|Karte|Tarjeta|Card|Aufgabe)\s*\d*\s*[:\-).\u2013\u2014]?\s*/i,
      ""
    )
    .replace(/^\s*\(?\d+\)?\s*[:.)\-\u2013\u2014]\s*/, "")
    .trim();

  const base = stripMarkdown(String(raw || ""))
    .replace(/^\s*(?:Hier|Here|Aquí|Aqui)[\s\S]*?[:\-\u2013\u2014]\s*/i, "")
    .trim();

  if (base.length < 20) return null;

  const cards = [];

  // Falls das Modell wenigstens die „Übung N:"-Marker gesetzt hat, teilen
  // wir daran auf und versuchen jeden Block einzeln zu retten.
  const blockRe = /^\s*(?:Übung|Ubung|Uebung|Exercise|Ejercicio|Flashcard|Karteikarte|Karte|Tarjeta|Card|Aufgabe)\s*\d+\s*[:\-).]?.*$/gim;
  const indices = [];
  let m;
  while ((m = blockRe.exec(base)) !== null) {
    indices.push(m.index);
  }

  const chunks = indices.length >= 1
    ? indices.map((start, i) => {
        const end = i + 1 < indices.length ? indices[i + 1] : base.length;
        return base.slice(start, end).trim();
      })
    : [base];

  for (const rawChunk of chunks) {
    const text = stripHeader(rawChunk).replace(/\s+/g, " ").trim();
    if (text.length < 20) continue;

    // Variante 1: Fragezeichen in der Mitte → davor Frage, danach Antwort.
    const qMarkIdx = text.search(/[?¿]/);
    if (qMarkIdx > 10 && qMarkIdx < text.length - 10) {
      const q = text.slice(0, qMarkIdx + 1).trim();
      const rest = text.slice(qMarkIdx + 1).trim();
      const firstSentence = rest.match(/^([^.!?]{10,200}[.!?])/)?.[1]?.trim()
        || rest.slice(0, 200).trim();
      if (q.length >= 5 && firstSentence.length >= 5) {
        cards.push({ question: q, answer: firstSentence });
        continue;
      }
    }

    // Variante 2: Prosa in zwei Sätzen – „X ist Y. Erläuterung …"
    // Dann wird eine echte Frage daraus abgeleitet, die den Hauptbegriff
    // des ersten Satzes aufgreift. Lieber eine Karte zum konkreten Stoff
    // als keine Karte.
    const sentences = text.match(/[^.!?]{10,}[.!?]/g);
    if (sentences && sentences.length >= 2) {
      const first = sentences[0].trim();
      const rest = sentences.slice(1).join(" ").trim();
      const derived = deriveQuestion(first);
      if (derived && rest.length >= 10) {
        cards.push({
          question: derived,
          answer: rest.slice(0, 220).trim()
        });
        continue;
      }
    }
  }

  return cards.length ? cards : null;
}

/**
 * Leitet aus einem deklarativen Satz eine Lernfrage ab, ohne eine
 * generische „Was ist wichtig?"-Floskel zu produzieren. Erkennt die
 * häufigsten Kopula-Muster („X ist Y", „X bezeichnet Y") und schneidet
 * den Hauptbegriff heraus.
 */
function deriveQuestion(sentence) {
  const clean = sentence.replace(/[.!]+$/g, "").trim();
  if (clean.length < 12) return null;

  // „X ist/sind/war/waren Y" → „Was ist X?"
  const copula = clean.match(/^(.{3,80}?)\s+(?:ist|sind|war|waren|bedeutet|bezeichnet|beschreibt|umfasst|is|are|was|were|means|describes|includes|es|son|era|eran|significa|describe|incluye)\b/i);
  if (copula) {
    const subject = copula[1].replace(/^der\s+|^die\s+|^das\s+|^the\s+|^el\s+|^la\s+|^los\s+|^las\s+/i, "").trim();
    if (subject.length >= 3) {
      return `Was ist ${subject}?`;
    }
  }

  // „X hat/haben Y" → „Welche Rolle hat X?"
  const possessive = clean.match(/^(.{3,80}?)\s+(?:hat|haben|hatte|hatten|has|have|had|tiene|tienen|tenía|tenían)\b/i);
  if (possessive) {
    const subject = possessive[1].replace(/^der\s+|^die\s+|^das\s+|^the\s+|^el\s+|^la\s+|^los\s+|^las\s+/i, "").trim();
    if (subject.length >= 3) {
      return `Welche Rolle hat ${subject}?`;
    }
  }

  // Hauptbegriff heuristisch: erstes Nomen (Großbuchstabe) oder erste
  // Nominalphrase bis zum ersten Verb.
  const noun = clean.match(/\b([A-ZÄÖÜ][\wäöüßéèáíóúñ-]{2,}(?:\s+[a-zäöüß][\wäöüßéèáíóúñ-]{2,})?)/);
  if (noun && noun[1].length >= 4) {
    return `Welche Bedeutung hat ${noun[1]}?`;
  }

  return null;
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
  // Format geht mit ein, weil MC & Cloze pro Übung deutlich mehr Tokens
  // brauchen als eine Karteikarte (vier Optionen + Erklärung vs. zwei Zeilen).
  request.metadata.quizCount = count;
  request.metadata.quizFormat = format;

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

    // Rettungsanker: aus der Rohantwort selbst eine Karte bauen.
    const rescued = rescueFromRaw(format, raw);
    if (rescued) {
      try {
        const validated = validateItems(format, rescued);
        items.push(...validated);
        console.warn("ATELIER AI: Rohtext-Rettung erfolgreich – 1 Karte.");
      } catch (rescueError) {
        console.warn("ATELIER AI: Rettung konnte nicht validiert werden:", rescueError);
      }
    }

    if (items.length === 0) {
      // Rohantwort in die Fehlermeldung einbetten, damit das Problem
      // auch auf dem iPad (ohne Konsolenzugriff) sichtbar bleibt.
      const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 220);
      throw new Error(
        `[Build ${BUILD}] Die KI-Antwort konnte nicht in Übungen zerlegt werden. ` +
        "Modell antwortete so: „" + snippet + (raw.length > 220 ? "…" : "") + "\""
      );
    }
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
    count = 3,
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

    // Format-abhängige Obergrenze für iPad-Verträglichkeit. Jede MC-Übung
    // kostet deutlich mehr Output-Tokens als eine Karteikarte, deshalb
    // niedrigere Grenze bei MC und Cloze. Flashcards vertragen 6, MC/Cloze
    // nur 5 pro Batch – darüber killt der KV-Cache den WebGPU-Adapter.
    const perFormatCap = {
      flashcards: 6,
      multipleChoice: 5,
      cloze: 5
    }[format] || 5;

    const requestedCount = Number(count) || 5;
    const amount = Math.max(
      2,
      Math.min(perFormatCap, requestedCount)
    );

    let localMaterials = [];
    let externalSource = null;

    if (useMaterials) {
      // Lokale Materialien aus der Wissensbasis
      localMaterials = await knowledgeBase.search(topic, subject);

      // Externe seriöse Quelle (OpenAlex-Fachliteratur, Wikipedia als
      // Rückfall). Wird IMMER zusätzlich geholt, nicht nur wenn lokale
      // Materialien fehlen – so bekommt der Nutzer belegte Übungen.
      externalSource = await fetchExternalContext(topic, language);
    }

    const materialContext = [
      ...localMaterials.map(item => ({
        title: item.title,
        content: item.content
      })),
      ...(externalSource ? [{
        title: externalSource.title,
        content: externalSource.content
      }] : [])
    ];

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

    // Hinweis: Keine automatische Nachlieferung mehr. Jede zusätzliche
    // Inferenzrunde kostet KV-Cache-Speicher und hat auf dem iPad
    // regelmäßig den WebGPU-Adapter gekillt. Lieber liefern wir, was
    // da ist – der Nutzer kann für mehr Karten einfach erneut auf
    // "Erzeugen" tippen; dann startet das Modell mit frischem Zustand.

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

      // Bei totalem GPU-Ausfall ist Reload auf iPadOS Safari leider
      // der einzig verlässliche Weg. Klarer Hinweis statt vager
      // Fehlermeldung.
      if (modelUnrecoverable) {
        throw new Error(
          "Das KI-Modell hat seinen GPU-Zustand verloren und konnte " +
          "trotz zweier Rettungsversuche nicht wiederhergestellt werden. " +
          "Bitte in Safari diesen Tab komplett schließen (Tab-Übersicht → " +
          "X-Symbol) und die Seite neu öffnen. Das Modell liegt im Cache, " +
          "lädt also schnell wieder."
        );
      }

      throw new Error(
        `[Build ${BUILD}] Es konnte keine einzige Übung erstellt werden. ` +
        "Letzter Grund: " + lastMessage +
        " – Bitte ein kleineres Modell wählen oder nur 2–3 Übungen auf einmal anfordern."
      );
    }

    // Falls das Modell weniger als die gewünschte Anzahl geliefert hat,
    // ist das okay – wir geben zurück, was wir haben.
    if (items.length > amount) {
      items = items.slice(0, amount);
    }

    const usedExternalSource = Boolean(externalSource);
    const externalSourceType = externalSource?.sourceType || null;

    return {
      format,
      formatName: FORMATS[format].label[language],
      subject,
      topic,
      level,
      language,
      items,
      materialCount: localMaterials.length,
      usedExternalSource,
      externalSourceType,
      externalSourceTitle: externalSource?.title || null,
      requested: amount,
      failures,
      createdAt: new Date().toISOString()
    };
  }
}

export const learningStudio = new LearningStudio();

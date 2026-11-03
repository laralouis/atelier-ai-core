
/**
 * ATELIER AI – Gemeinsame Wissensbasis
 * Version 0.4
 *
 * Speicherung lokal über IndexedDB.
 * Feinkörnige, konzept-sensitive Suche.
 *
 * Bestehende Datenbank und gespeicherte Materialien
 * bleiben erhalten (DB_VERSION bleibt 1).
 */

const DB_NAME = "atelier-ai-knowledge";
const DB_VERSION = 1;
const STORE_NAME = "materials";

// Begrenzung für die lokale KI – kleinere, fokussiertere Chunks
// erlauben präzisere Treffer und sparen Kontext-Budget. Werte
// bewusst konservativ: der iPad-WebGPU-Adapter kippt, sobald das
// Kontextfenster zu groß wird (KV-Cache × Layer × Output-Tokens).
const MAX_CHUNK_LENGTH = 420;
const MIN_CHUNK_LENGTH = 120;
const MAX_CHUNKS_PER_MATERIAL = 5;
const MAX_TOTAL_CONTEXT = 1200;

// Häufige Wörter ohne großen Suchwert
const STOP_WORDS = new Set([
  "aber", "alle", "allem", "allen", "aller",
  "alles", "also", "andere", "anderen",
  "anderer", "anderes", "auch", "auf",
  "aus", "bei", "beim", "bereits", "bis",
  "bist", "da", "dabei", "dadurch", "daher",
  "damit", "dann", "darauf", "das", "dass",
  "dein", "deine", "dem", "den", "denn",
  "der", "des", "dessen", "die", "dies",
  "diese", "diesem", "diesen", "dieser",
  "dieses", "doch", "dort", "durch", "ein",
  "eine", "einem", "einen", "einer",
  "eines", "einig", "einige", "einem",
  "einmal", "er", "es", "etwas", "für",
  "gegen", "gewesen", "hat", "hatte",
  "haben", "hier", "hin", "hinter", "ich",
  "ihm", "ihn", "ihnen", "ihr", "ihre",
  "ihrem", "ihren", "ihrer", "ihres",
  "immer", "in", "indem", "ins", "ist",
  "jede", "jedem", "jeden", "jeder",
  "jedes", "jedoch", "kein", "keine",
  "keinem", "keinen", "keiner", "können",
  "könnte", "machen", "man", "mehr",
  "mein", "meine", "mit", "muss", "müssen",
  "nach", "nicht", "nichts", "noch", "nun",
  "nur", "ob", "oder", "ohne", "sehr",
  "sein", "seine", "seinem", "seinen",
  "seiner", "seines", "selbst", "sich",
  "sie", "sind", "so", "solche", "solchem",
  "solchen", "solcher", "solches", "soll",
  "sollen", "sondern", "sonst", "über",
  "um", "und", "uns", "unser", "unsere",
  "unter", "vom", "von", "vor", "war",
  "waren", "was", "weil", "weiter", "welche",
  "welchem", "welchen", "welcher", "welches",
  "wenn", "wer", "werde", "werden", "wie",
  "wieder", "wir", "wird", "wirst", "wo",
  "wollen", "wollte", "zu", "zum", "zur",
  "zwischen"
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(word =>
      word.length > 2 &&
      !STOP_WORDS.has(word)
    );
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error("IndexedDB wird nicht unterstützt.")
      );
      return;
    }

    const request = indexedDB.open(
      DB_NAME,
      DB_VERSION
    );

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(
          STORE_NAME,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );

        store.createIndex("subject", "subject");
        store.createIndex("title", "title");
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      reject(
        request.error ||
        new Error("Datenbank konnte nicht geöffnet werden.")
      );
    };
  });
}

/**
 * Zerlegt den Text in kleine, inhaltlich fokussierte Abschnitte.
 *
 * Strategie:
 * 1. An Absatzgrenzen trennen
 * 2. Zu lange Absätze an Satzgrenzen weiter zerlegen
 * 3. Zu kurze Nachbar-Chunks zusammenführen
 *
 * Ergebnis: ~200-420 Zeichen pro Chunk, Satzgrenzen bleiben erhalten.
 */
function splitIntoChunks(content) {
  const text = String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^---\s*Seite\s*\d+\s*---/gm, "");

  const paragraphs = text
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);

  const rawChunks = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_LENGTH) {
      rawChunks.push(paragraph);
      continue;
    }

    // Lange Absätze an Satzgrenzen aufteilen
    const sentences = paragraph.match(/[^.!?\n]+[.!?]+|\s*[-*•]\s+[^\n]+|[^\n]{10,}/g)
      || [paragraph];

    let group = "";
    for (const sentence of sentences) {
      const piece = sentence.trim();
      if (!piece) continue;

      if (
        group &&
        group.length + piece.length + 1 > MAX_CHUNK_LENGTH
      ) {
        rawChunks.push(group);
        group = "";
      }

      group += (group ? " " : "") + piece;
    }

    if (group) rawChunks.push(group);
  }

  // Zu kurze Chunks mit dem nächsten zusammenlegen
  const chunks = [];
  for (const chunk of rawChunks) {
    const last = chunks[chunks.length - 1];
    if (
      last &&
      last.length < MIN_CHUNK_LENGTH &&
      last.length + chunk.length + 2 <= MAX_CHUNK_LENGTH
    ) {
      chunks[chunks.length - 1] = last + "\n\n" + chunk;
    } else {
      chunks.push(chunk);
    }
  }

  return chunks.filter(chunk => chunk.length >= 40);
}

/**
 * Bewertet die inhaltliche Übereinstimmung eines Textabschnitts
 * mit der Anfrage. Berücksichtigt:
 * - exakte Treffer der Anfragewörter (hohes Gewicht)
 * - Teilstring-Treffer (mittleres Gewicht)
 * - Phrasentreffer (Bonus)
 * - Dichte: viele Treffer in kurzem Chunk ist wertvoller
 */
function scoreChunk(chunk, queryWords) {
  const normalized = normalizeText(chunk);
  const chunkWords = tokenize(chunk);

  let score = 0;
  let hitCount = 0;

  for (const word of queryWords) {
    const exactMatches = chunkWords.filter(
      item => item === word
    ).length;

    const relatedMatches = chunkWords.filter(
      item =>
        item.length >= 5 &&
        word.length >= 5 &&
        (
          item.startsWith(word) ||
          word.startsWith(item) ||
          item.includes(word) ||
          word.includes(item)
        )
    ).length;

    if (exactMatches > 0) {
      score += Math.min(exactMatches, 3) * 3;
      hitCount += exactMatches;
    } else if (relatedMatches > 0) {
      score += Math.min(relatedMatches, 2);
      hitCount += 1;
    }
  }

  // Phrasen-Bonus
  if (
    queryWords.length > 1 &&
    normalized.includes(queryWords.join(" "))
  ) {
    score += 6;
  }

  // Dichte-Bonus: viele Treffer in einem kurzen Chunk sind wertvoller
  if (hitCount > 0 && chunkWords.length > 0) {
    const density = hitCount / Math.max(10, chunkWords.length);
    score += Math.round(density * 10);
  }

  return score;
}

/**
 * Bewertet, wie gut die gespeicherten Schlüsselbegriffe eines Materials
 * zur Anfrage passen. Konzept-Treffer sind stärker gewichtet als
 * zufällige Wort-Treffer im Text, weil sie strukturierte Information
 * aus dem Material repräsentieren.
 */
function scoreConcepts(concepts, queryWords) {
  if (!Array.isArray(concepts) || !concepts.length) return 0;

  let score = 0;

  for (const concept of concepts) {
    const conceptWords = tokenize(String(concept || ""));
    if (!conceptWords.length) continue;

    for (const query of queryWords) {
      if (conceptWords.includes(query)) {
        score += 4;
      } else if (
        query.length >= 5 &&
        conceptWords.some(
          cw =>
            cw.length >= 5 &&
            (cw.startsWith(query) ||
             query.startsWith(cw) ||
             cw.includes(query))
        )
      ) {
        score += 2;
      }
    }
  }

  return score;
}

export class KnowledgeBase {

  /**
   * Speichert ein neues Lernmaterial.
   * concepts[] und summary werden optional mitgespeichert und
   * verbessern später die Suchpräzision deutlich.
   */
  async add({
    subject,
    title,
    content,
    concepts = [],
    summary = "",
    source = "manual"
  }) {
    if (
      !subject ||
      typeof title !== "string" ||
      !title.trim() ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      throw new Error(
        "Fach, Titel und Inhalt sind erforderlich."
      );
    }

    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        STORE_NAME,
        "readwrite"
      );

      const request = transaction
        .objectStore(STORE_NAME)
        .add({
          subject,
          title: title.trim(),
          content: content.trim(),
          concepts: Array.isArray(concepts)
            ? concepts.filter(c => typeof c === "string").slice(0, 50)
            : [],
          summary: typeof summary === "string" ? summary.slice(0, 600) : "",
          source,
          createdAt: new Date().toISOString()
        });

      let insertedId = null;
      let failed = false;

      request.onsuccess = () => {
        insertedId = request.result;
      };

      transaction.oncomplete = () => {
        db.close();
        resolve(insertedId);
      };

      transaction.onerror = () => {
        failed = true;
        db.close();

        reject(
          transaction.error ||
          new Error("Material konnte nicht gespeichert werden.")
        );
      };

      transaction.onabort = () => {
        if (!failed) {
          db.close();

          reject(
            transaction.error ||
            new Error("Speichervorgang wurde abgebrochen.")
          );
        }
      };
    });
  }

  /**
   * Lädt alle Materialien oder die eines Fachs.
   */
  async getAll(subject = null) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        STORE_NAME,
        "readonly"
      );

      const store = transaction.objectStore(STORE_NAME);

      const request = subject
        ? store.index("subject").getAll(subject)
        : store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error("Materialien konnten nicht geladen werden.")
        );
      };

      transaction.oncomplete = () => db.close();

      transaction.onabort = () => {
        db.close();

        reject(
          transaction.error ||
          new Error("Lesevorgang wurde abgebrochen.")
        );
      };
    });
  }

  /**
   * Sucht relevante Abschnitte in den Lernmaterialien.
   *
   * Rückgabe bleibt kompatibel mit engine.js:
   * id, subject, title, content und score.
   */
  async search(query, subject = null) {
    if (
      typeof query !== "string" ||
      !query.trim()
    ) {
      return [];
    }

    const queryWords = [
      ...new Set(tokenize(query))
    ];

    if (!queryWords.length) return [];

    const materials = await this.getAll(subject);

    const matches = [];

    for (const material of materials) {
      const title = String(material.title || "");
      const concepts = material.concepts || [];
      const summary = String(material.summary || "");
      const chunks = splitIntoChunks(material.content);

      const titleScore = scoreChunk(title, queryWords);
      const conceptScore = scoreConcepts(concepts, queryWords);
      const summaryScore = summary
        ? Math.round(scoreChunk(summary, queryWords) * 1.5)
        : 0;

      const scoredChunks = chunks
        .map((content, index) => {
          const base = scoreChunk(content, queryWords);
          const score = base
            + titleScore * 2
            + Math.round(conceptScore * 0.5)
            + Math.round(summaryScore * 0.3);

          return {
            content,
            index,
            score,
            baseScore: base
          };
        })
        .filter(chunk => chunk.baseScore > 0 || chunk.score > 3)
        .sort((a, b) => b.score - a.score);

      if (!scoredChunks.length && conceptScore === 0 && titleScore === 0) {
        continue;
      }

      // Falls Material relevant ist, aber kein einzelner Chunk Treffer
      // hat (nur über Titel/Konzept-Match), geben wir die aussagekräftigste
      // Zusammenfassung mit – Anfang des Materials oder summary-Feld.
      const effectiveChunks = scoredChunks.length
        ? scoredChunks
        : [{ content: summary || chunks[0] || "", index: 0, score: titleScore + conceptScore }];

      const selected = effectiveChunks
        .slice(0, MAX_CHUNKS_PER_MATERIAL)
        .sort((a, b) => a.index - b.index);

      let selectedContent = "";
      let usedCharacters = 0;

      for (const chunk of selected) {
        const addition =
          (selectedContent ? "\n\n" : "") +
          chunk.content;

        if (
          usedCharacters + addition.length >
          MAX_TOTAL_CONTEXT
        ) {
          const remaining =
            MAX_TOTAL_CONTEXT - usedCharacters;

          if (remaining > 150) {
            selectedContent +=
              (selectedContent ? "\n\n" : "") +
              chunk.content.slice(0, remaining);
          }

          break;
        }

        selectedContent += addition;
        usedCharacters += addition.length;
      }

      if (!selectedContent) continue;

      const totalScore = effectiveChunks.reduce(
        (total, chunk) => total + chunk.score,
        0
      ) + conceptScore + summaryScore;

      matches.push({
        ...material,
        content: selectedContent,
        matchedConcepts: concepts
          .filter(c => {
            const cw = tokenize(String(c));
            return cw.some(w => queryWords.includes(w));
          })
          .slice(0, 5),
        score: totalScore
      });
    }

    const sorted = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // Fallback: Treffer leer, aber die Schülerin HAT Materialien zu
    // diesem Fach hochgeladen. Dann die ersten Chunks des neuesten
    // Materials als „thematischer Hintergrund" mitgeben, damit die KI
    // die eigenen Materialien überhaupt sieht. Verhindert generische
    // Übungen, die am konkreten Stoff vorbeigehen.
    if (!sorted.length && materials.length) {
      const freshest = [...materials].sort((a, b) => {
        const timeA = new Date(a.importedAt || 0).getTime();
        const timeB = new Date(b.importedAt || 0).getTime();
        return timeB - timeA;
      });

      const fallback = [];
      let used = 0;

      for (const material of freshest) {
        if (used >= MAX_TOTAL_CONTEXT) break;

        const chunks = splitIntoChunks(material.content);
        const take = chunks.slice(0, MAX_CHUNKS_PER_MATERIAL);
        let selectedContent = "";

        for (const chunk of take) {
          if (used + chunk.length > MAX_TOTAL_CONTEXT) {
            const remaining = MAX_TOTAL_CONTEXT - used;
            if (remaining > 150) {
              selectedContent += (selectedContent ? "\n\n" : "") + chunk.slice(0, remaining);
              used = MAX_TOTAL_CONTEXT;
            }
            break;
          }
          selectedContent += (selectedContent ? "\n\n" : "") + chunk;
          used += chunk.length;
        }

        if (selectedContent) {
          fallback.push({
            ...material,
            content: selectedContent,
            matchedConcepts: (material.concepts || []).slice(0, 5),
            score: 0,
            fallback: true
          });
        }
      }

      return fallback.slice(0, 2);
    }

    return sorted;
  }

  /**
   * Löscht ein Material anhand seiner ID.
   */
  async remove(id) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        STORE_NAME,
        "readwrite"
      );

      transaction.objectStore(STORE_NAME).delete(id);

      transaction.oncomplete = () => {
        db.close();
        resolve(true);
      };

      transaction.onerror = () => {
        db.close();

        reject(
          transaction.error ||
          new Error("Material konnte nicht gelöscht werden.")
        );
      };

      transaction.onabort = () => {
        db.close();

        reject(
          transaction.error ||
          new Error("Löschvorgang wurde abgebrochen.")
        );
      };
    });
  }
}

export const knowledgeBase = new KnowledgeBase();


/**
 * ATELIER AI – Gemeinsame Wissensbasis
 * Version 0.3
 *
 * Speicherung lokal über IndexedDB.
 * Strukturierte Suche mit relevanten Textabschnitten.
 *
 * Bestehende Datenbank und gespeicherte Materialien
 * bleiben erhalten.
 */

const DB_NAME = "atelier-ai-knowledge";
const DB_VERSION = 1;
const STORE_NAME = "materials";

// Begrenzung für die lokale KI
const MAX_CHUNK_LENGTH = 1100;
const MAX_CHUNKS_PER_MATERIAL = 3;
const MAX_TOTAL_CONTEXT = 5000;

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
 * Zerlegt den Text in Abschnitte.
 *
 * Zusammengehörige Stichpunkte bleiben möglichst
 * im selben Abschnitt.
 */
function splitIntoChunks(content) {
  const text = String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const paragraphs = text
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_LENGTH) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      const lines = paragraph
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      let lineGroup = "";

      for (const line of lines) {
        if (
          lineGroup &&
          lineGroup.length + line.length + 1 >
          MAX_CHUNK_LENGTH
        ) {
          chunks.push(lineGroup);
          lineGroup = "";
        }

        lineGroup +=
          (lineGroup ? "\n" : "") + line;
      }

      if (lineGroup) chunks.push(lineGroup);
      continue;
    }

    if (
      current &&
      current.length + paragraph.length + 2 >
      MAX_CHUNK_LENGTH
    ) {
      chunks.push(current);
      current = "";
    }

    current +=
      (current ? "\n\n" : "") + paragraph;
  }

  if (current) chunks.push(current);

  return chunks;
}

/**
 * Bewertet die inhaltliche Übereinstimmung.
 */
function scoreChunk(chunk, queryWords) {
  const normalized = normalizeText(chunk);
  const chunkWords = tokenize(chunk);

  let score = 0;

  for (const word of queryWords) {
    const exactMatches = chunkWords.filter(
      item => item === word
    ).length;

    const relatedMatches = chunkWords.filter(
      item =>
        item.length >= 6 &&
        word.length >= 6 &&
        (
          item.startsWith(word) ||
          word.startsWith(item)
        )
    ).length;

    if (exactMatches > 0) {
      score += Math.min(exactMatches, 3) * 3;
    } else if (relatedMatches > 0) {
      score += 1;
    }
  }

  if (
    queryWords.length > 1 &&
    normalized.includes(queryWords.join(" "))
  ) {
    score += 5;
  }

  return score;
}

export class KnowledgeBase {

  /**
   * Speichert ein neues Lernmaterial.
   */
  async add({
    subject,
    title,
    content,
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
      const titleWords = tokenize(title);
      const chunks = splitIntoChunks(material.content);

      const scoredChunks = chunks
        .map((content, index) => {
          let score = scoreChunk(
            content,
            queryWords
          );

          const titleScore = scoreChunk(
            title,
            queryWords
          );

          score += titleScore * 2;

          return {
            content,
            index,
            score
          };
        })
        .filter(chunk => chunk.score > 0)
        .sort((a, b) => b.score - a.score);

      if (!scoredChunks.length) continue;

      const selected = scoredChunks
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

      matches.push({
        ...material,
        content: selectedContent,
        score:
          scoredChunks.reduce(
            (total, chunk) => total + chunk.score,
            0
          )
      });
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
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

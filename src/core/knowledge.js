
/**
 * ATELIER AI – Gemeinsame Wissensbasis
 * Version 0.1
 *
 * Speicherung lokal im Browser über IndexedDB.
 */

const DB_NAME = "atelier-ai-knowledge";
const DB_VERSION = 1;
const STORE_NAME = "materials";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(
          STORE_NAME,
          { keyPath: "id", autoIncrement: true }
        );

        store.createIndex("subject", "subject");
        store.createIndex("title", "title");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class KnowledgeBase {
  async add({
    subject,
    title,
    content,
    source = "manual"
  }) {
    if (!subject || !title || !content) {
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

      const request = transaction.objectStore(STORE_NAME).add({
        subject,
        title,
        content,
        source,
        createdAt: new Date().toISOString()
      });

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);

      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  }

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
        resolve(request.result);
      };

      request.onerror = () => reject(request.error);

      transaction.oncomplete = () => db.close();
    });
  }

  async search(query, subject = null) {
    const materials = await this.getAll(subject);

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2);

    return materials
      .map(material => {
        const text = (
          material.title + " " + material.content
        ).toLowerCase();

        const score = words.reduce(
          (total, word) =>
            total + (text.includes(word) ? 1 : 0),
          0
        );

        return { ...material, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

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
        reject(transaction.error);
      };
    });
  }
}

export const knowledgeBase = new KnowledgeBase();

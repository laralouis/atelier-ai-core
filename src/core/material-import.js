
/**
 * ATELIER AI – Material Import
 * Version 0.2
 *
 * Strukturierter Import von PDF und TXT.
 * Erhält möglichst:
 * - Überschriften
 * - Absätze
 * - Stichpunkte
 * - Nummerierungen
 * - Seitenumbrüche
 * - Zeilenreihenfolge
 */

export class MaterialImporter {

  async importFile(file) {
    if (!file) {
      throw new Error("Keine Datei ausgewählt.");
    }

    const extension = file.name
      .split(".")
      .pop()
      .toLowerCase();

    let content = "";
    let pageCount = null;

    if (extension === "txt") {
      content = await this.extractTXT(file);
    } else if (extension === "pdf") {
      const result = await this.extractPDF(file);
      content = result.content;
      pageCount = result.pageCount;
    } else {
      throw new Error(
        "Unterstützt werden zunächst PDF und TXT."
      );
    }

    content = this.cleanText(content);

    if (!content.trim()) {
      throw new Error(
        "Die Datei enthält keinen lesbaren Text."
      );
    }

    return {
      title: file.name,
      content,
      fileType: extension,
      size: file.size,
      pageCount,
      importedAt: new Date().toISOString()
    };
  }

  /**
   * TXT-Dateien einlesen.
   * Vorhandene Zeilenumbrüche bleiben erhalten.
   */
  async extractTXT(file) {
    const text = await file.text();

    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  /**
   * PDF-Dateien strukturiert auslesen.
   */
  async extractPDF(file) {

    const pdfjs = await import(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"
    );

    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

    const buffer = await file.arrayBuffer();

    const pdf = await pdfjs.getDocument({
      data: buffer
    }).promise;

    const pages = [];

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);

      const textContent = await page.getTextContent();

      const lines = this.groupPDFLines(
        textContent.items
      );

      const pageText = lines.join("\n");

      pages.push(
        `--- Seite ${pageNumber} ---\n\n${pageText}`
      );
    }

    return {
      content: pages.join("\n\n"),
      pageCount: pdf.numPages
    };
  }

  /**
   * Textbausteine anhand ihrer vertikalen Position
   * zu Zeilen zusammenfassen.
   */
  groupPDFLines(items) {

    const validItems = items
      .filter(item =>
        item.str &&
        item.str.trim().length > 0 &&
        item.transform
      )
      .map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || 0
      }));

    // PDF-Koordinaten: oben nach unten sortieren.
    validItems.sort((a, b) => {
      const difference = b.y - a.y;

      if (Math.abs(difference) > 2.5) {
        return difference;
      }

      return a.x - b.x;
    });

    const lines = [];

    for (const item of validItems) {

      let currentLine = lines.find(line =>
        Math.abs(line.y - item.y) <= 2.5
      );

      if (!currentLine) {
        currentLine = {
          y: item.y,
          items: []
        };

        lines.push(currentLine);
      }

      currentLine.items.push(item);
    }

    // Jede Zeile horizontal sortieren.
    return lines
      .sort((a, b) => b.y - a.y)
      .map(line => {

        line.items.sort((a, b) => a.x - b.x);

        let result = "";
        let previous = null;

        for (const item of line.items) {

          const text = item.text.trim();

          if (!text) continue;

          if (previous) {
            const gap =
              item.x -
              (previous.x + previous.width);

            // Bei größeren horizontalen Abständen
            // ein Leerzeichen ergänzen.
            if (gap > 1.5) {
              result += " ";
            }
          }

          result += text;

          previous = item;
        }

        return result.trim();

      })
      .filter(line => line.length > 0);
  }

  /**
   * Text bereinigen, ohne die Dokumentstruktur
   * vollständig zu entfernen.
   */
  cleanText(text) {

    return text
      .replace(/\u0000/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

export const materialImporter = new MaterialImporter();

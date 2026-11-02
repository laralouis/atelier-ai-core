/**
 * ATELIER AI – Material Import
 * Version 0.1
 *
 * Unterstützt PDF und TXT.
 */

export class MaterialImporter {
  async importFile(file) {
    if (!file) {
      throw new Error("Keine Datei ausgewählt.");
    }

    const extension = file.name.split(".").pop().toLowerCase();

    let content;

    if (extension === "txt") {
      content = await file.text();
    } else if (extension === "pdf") {
      content = await this.extractPDF(file);
    } else {
      throw new Error("Unterstützt werden zunächst PDF und TXT.");
    }

    if (!content.trim()) {
      throw new Error("Die Datei enthält keinen lesbaren Text.");
    }

    return {
      title: file.name,
      content: content.trim(),
      fileType: extension,
      size: file.size,
      importedAt: new Date().toISOString()
    };
  }

  async extractPDF(file) {
    const pdfjs = await import(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"
    );

    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    let fullText = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();

      fullText += text.items
        .map(item => item.str)
        .join(" ") + "\n\n";
    }

    return fullText;
  }
}

export const materialImporter = new MaterialImporter();

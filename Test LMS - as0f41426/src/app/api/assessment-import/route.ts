import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as XLSX from "xlsx";
import {
  fileNameToTitle,
  parseMicrosoftFormsAssessment,
  parsePlainTextAssessment,
  parseSpreadsheetRows,
} from "@/lib/assessment-import";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

async function extractPdfText(bytes: Uint8Array) {
  const tempPath = path.join(os.tmpdir(), `assessment-import-${randomUUID()}.pdf`);

  try {
    await writeFile(tempPath, bytes);

    const script = `
      import fs from "node:fs";
      import { PDFParse } from "pdf-parse";

      const parser = new PDFParse({ data: fs.readFileSync(process.argv[1]) });
      const result = await parser.getText();
      await parser.destroy();
      process.stdout.write(JSON.stringify({ text: result.text }));
    `;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script, tempPath],
      { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 }
    );

    const payload = JSON.parse(stdout) as { text?: string };
    return payload.text ?? "";
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a file to import." }, { status: 400 });
    }

    const fileName = file.name || "import";
    const extension = fileName.split(".").pop()?.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    let assessments = [] as ReturnType<typeof parsePlainTextAssessment>;

    if (extension === "csv" || extension === "xlsx" || extension === "xls") {
      const workbook = XLSX.read(bytes, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      assessments = parseSpreadsheetRows(rows, fileName);
    } else if (extension === "pdf") {
      const text = await extractPdfText(bytes);
      assessments = parseMicrosoftFormsAssessment(text, fileName);

      if (!assessments.length) {
        assessments = parsePlainTextAssessment(text, fileName);
      }
    } else {
      const text = new TextDecoder().decode(bytes);
      assessments = parsePlainTextAssessment(text, fileName);
    }

    if (!assessments.length) {
      return NextResponse.json(
        {
          error:
            "No assessments were detected. For spreadsheets, include columns like Assessment, Question, Type, Options, and Correct Answer. For PDFs, use numbered questions with answer lines.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      fileName,
      importedCount: assessments.length,
      assessments: assessments.map((assessment) => ({
        ...assessment,
        title: assessment.title || fileNameToTitle(fileName),
      })),
    });
  } catch (error) {
    console.error("assessment import failed", error);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : "Could not import that file.",
      },
      { status: 500 }
    );
  }
}

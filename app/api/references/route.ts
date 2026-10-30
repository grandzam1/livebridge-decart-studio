import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, noContent, readJson, requireOrigin } from "@/lib/api";
import { maxImageBytes } from "@/lib/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERENCES_DIR = path.join(process.cwd(), "public", "references");
const EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
]);
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type SavedReference = { name: string; url: string };

function toSavedReference(name: string): SavedReference {
  return { name, url: `/references/${name}` };
}

function isReferenceFile(name: string) {
  return SAFE_NAME.test(name) && !name.includes("..") && [...EXTENSIONS.values()].includes(path.extname(name).toLowerCase());
}

async function listReferences(): Promise<SavedReference[]> {
  try {
    const entries = await readdir(REFERENCES_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isReferenceFile(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .map((entry) => toSavedReference(entry.name));
  } catch {
    return [];
  }
}

export async function GET() {
  return jsonOk({ images: await listReferences() });
}

export async function POST(request: Request) {
  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    // Fall through to the 400 below.
  }
  if (!file) return jsonError(400, "BAD_REQUEST", "Send the image as multipart form data in the `file` field.");

  const extension = EXTENSIONS.get(file.type);
  if (!extension) return jsonError(400, "BAD_REQUEST", "That file type is not supported.", "Use a PNG, JPEG, WebP, GIF, or AVIF image.");
  if (file.size <= 0 || file.size > maxImageBytes) {
    return jsonError(400, "BAD_REQUEST", `The image must be up to ${publicLabel()} in size.`);
  }

  const name = `${Date.now().toString(36)}-${crypto.randomUUID()}${extension}`;
  await mkdir(REFERENCES_DIR, { recursive: true });
  await writeFile(path.join(REFERENCES_DIR, name), Buffer.from(await file.arrayBuffer()));
  return jsonOk({ image: toSavedReference(name) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  const body = await readJson<{ name: string }>(request);
  if (body instanceof NextResponse) return body;
  const name = body.name;
  if (typeof name !== "string" || !isReferenceFile(name)) {
    return jsonError(400, "BAD_REQUEST", "Provide the saved image `name` to delete.");
  }

  try {
    await unlink(path.join(REFERENCES_DIR, name));
  } catch {
    // Already gone — treat as deleted.
  }
  return noContent();
}

function publicLabel() {
  return `${Math.round(maxImageBytes / 1024 / 1024)} MB`;
}

import { randomUUID } from "node:crypto";
import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextRequest, NextResponse } from "next/server";
import { publicUrl, uploadObject } from "@/lib/storage";
import { safeFileName } from "@/lib/storage/paths";
import { UPLOAD_LIMITS } from "@/lib/storage/rules";

async function isAuthorized(): Promise<boolean> {
  return isPlatformAdmin();
}

// POST /api/admin/portfolio/upload (multipart: file) → { url, public_id }
// Stored in the public 'catalog' bucket under portfolio/ (platform-level, no workspace).
export async function POST(request: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const limits = UPLOAD_LIMITS.catalog;
    if (file.size === 0 || file.size > limits.maxBytes) {
      return NextResponse.json({ error: "File is empty or too large" }, { status: 413 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only images can be uploaded" }, { status: 415 });
    }

    const path = `portfolio/${randomUUID()}-${safeFileName(file.name)}`;
    await uploadObject("catalog", path, Buffer.from(await file.arrayBuffer()), file.type);

    return NextResponse.json({
      url: publicUrl("catalog", path),
      public_id: path,
    });
  } catch (error) {
    console.error("Portfolio upload error:", error);
    return NextResponse.json(
      { error: (error instanceof Error && error.message) || "Failed to upload file" },
      { status: 500 }
    );
  }
}

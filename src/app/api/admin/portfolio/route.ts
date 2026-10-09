import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isPrismaError } from "@/lib/db/errors";
import { isUuid } from "@/lib/workspace/constants";

async function isAuthorized(): Promise<boolean> {
  return isPlatformAdmin();
}

// Prisma P2021: the table does not exist (frontend falls back to localStorage).
function tableMissing(error: unknown): boolean {
  return isPrismaError(error, "P2021") || (error instanceof Error && error.message.includes("does not exist"));
}

// GET /api/admin/portfolio - Get all showcase items
export async function GET() {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let data;
    try {
      // Platform data: portfolio_items has no workspace.
      data = await prisma.portfolio_items.findMany({ orderBy: { created_at: "desc" } });
    } catch (error) {
      // If table doesn't exist, we send a specific hint so frontend falls back to localStorage
      if (tableMissing(error)) {
        return NextResponse.json({
          items: [],
          db_fallback: true,
          message: "portfolio_items table does not exist. Using local storage fallback."
        });
      }
      throw error;
    }

    return NextResponse.json({ items: data ?? [], db_fallback: false });
  } catch (error) {
    console.error("GET portfolio error:", error);
    return NextResponse.json({ error: (error instanceof Error && error.message) || "Failed to fetch items" }, { status: 500 });
  }
}

// POST /api/admin/portfolio - Create a new showcase item
export async function POST(req: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, description, thumbnail_url, metadata_tags, project_links, preview_media } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    let data;
    try {
      data = await prisma.portfolio_items.create({
        data: {
          title,
          description: description || null,
          thumbnail_url: thumbnail_url || null,
          metadata_tags: metadata_tags || [],
          project_links: project_links || {},
          preview_media: preview_media || []
        }
      });
    } catch (error) {
      if (tableMissing(error)) {
        return NextResponse.json({
          db_fallback: true,
          message: "portfolio_items table does not exist. Using local storage fallback."
        });
      }
      throw error;
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error("POST portfolio error:", error);
    return NextResponse.json({ error: (error instanceof Error && error.message) || "Failed to create item" }, { status: 500 });
  }
}

// PUT /api/admin/portfolio - Update an existing showcase item
export async function PUT(req: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, title, description, thumbnail_url, metadata_tags, project_links, preview_media } = body;

    if (!id || !title) {
      return NextResponse.json({ error: "ID and Title are required" }, { status: 400 });
    }

    let data;
    try {
      // .single() on zero rows was an error → 500, as before.
      if (!isUuid(id)) throw new Error("Cannot coerce the result to a single JSON object");
      data = await prisma.portfolio_items.update({
        where: { id },
        data: {
          title,
          description: description || null,
          thumbnail_url: thumbnail_url || null,
          metadata_tags: metadata_tags || [],
          project_links: project_links || {},
          preview_media: preview_media || [],
          updated_at: new Date().toISOString()
        }
      });
    } catch (error) {
      if (tableMissing(error)) {
        return NextResponse.json({
          db_fallback: true,
          message: "portfolio_items table does not exist. Using local storage fallback."
        });
      }
      throw error;
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error("PUT portfolio error:", error);
    return NextResponse.json({ error: (error instanceof Error && error.message) || "Failed to update item" }, { status: 500 });
  }
}

// DELETE /api/admin/portfolio - Delete a showcase item
export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID parameter is required" }, { status: 400 });
    }

    try {
      // Unknown ids delete nothing (PostgREST did the same); a non-uuid was a 500.
      if (!isUuid(id)) throw new Error(`invalid input syntax for type uuid: "${id}"`);
      await prisma.portfolio_items.deleteMany({ where: { id } });
    } catch (error) {
      if (tableMissing(error)) {
        return NextResponse.json({
          db_fallback: true,
          message: "portfolio_items table does not exist."
        });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE portfolio error:", error);
    return NextResponse.json({ error: (error instanceof Error && error.message) || "Failed to delete item" }, { status: 500 });
  }
}

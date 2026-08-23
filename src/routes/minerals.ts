/**
 * @file minerals.ts
 * 
 * Minerals & Crystallography API router.
 * Provides paginated infinite-scroll querying, multi-criteria filtering,
 * and automated mineral synchronization.
 */

import { Router, Request, Response } from "express";
import { refDb } from "../db/refDb";
import { minerals } from "../db/schema";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { syncMineralDatabase } from "../services/mineralSourcing";

const router = Router();

/**
 * GET /api/minerals
 * Paginated infinite-scroll search and multi-criteria filters
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;

    const q = (req.query.q as string)?.trim();
    const crystalSystem = (req.query.crystalSystem as string)?.trim();
    const mineralClass = (req.query.mineralClass as string)?.trim();
    const minHardness = parseFloat(req.query.minHardness as string);
    const maxHardness = parseFloat(req.query.maxHardness as string);
    const sortBy = (req.query.sortBy as string)?.trim() || "name";

    const conditions = [];

    // Search query across name, formula, class, and associated rocks
    if (q) {
      conditions.push(
        or(
          ilike(minerals.name, `%${q}%`),
          ilike(minerals.formula, `%${q}%`),
          ilike(minerals.mineralClass, `%${q}%`),
          ilike(minerals.commonAssociatedRocks, `%${q}%`),
          ilike(minerals.diagnosticFeatures, `%${q}%`),
          ilike(minerals.industrialUses, `%${q}%`)
        )
      );
    }

    if (crystalSystem && crystalSystem !== "all") {
      conditions.push(ilike(minerals.crystalSystem, `%${crystalSystem}%`));
    }

    if (mineralClass && mineralClass !== "all") {
      conditions.push(ilike(minerals.mineralClass, `%${mineralClass}%`));
    }

    if (!isNaN(minHardness)) {
      conditions.push(gte(minerals.mohsHardnessMax, minHardness));
    }

    if (!isNaN(maxHardness)) {
      conditions.push(lte(minerals.mohsHardnessMin, maxHardness));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Sorting
    let orderClause = asc(minerals.name);
    if (sortBy === "hardness_asc") {
      orderClause = asc(minerals.mohsHardnessMin);
    } else if (sortBy === "hardness_desc") {
      orderClause = desc(minerals.mohsHardnessMax);
    } else if (sortBy === "gravity") {
      orderClause = desc(minerals.specificGravity);
    } else if (sortBy === "class") {
      orderClause = asc(minerals.mineralClass);
    } else if (q) {
      // Relevance ranking for text search: exact name match -> prefix match -> priority -> alphabetical
      orderClause = sql`
        CASE 
          WHEN LOWER(${minerals.name}) = LOWER(${q}) THEN 1
          WHEN LOWER(${minerals.name}) LIKE LOWER(${q + '%'}) THEN 2
          ELSE 3
        END ASC,
        COALESCE((${minerals.metadata}->>'priority')::int, 0) DESC,
        ${minerals.name} ASC
      ` as any;
    }

    // Query Data & Count in parallel
    const [data, totalCountResult] = await Promise.all([
      refDb
        .select()
        .from(minerals)
        .where(whereClause)
        .orderBy(orderClause)
        .limit(limit)
        .offset(offset),
      refDb
        .select({ count: sql<number>`count(*)::int` })
        .from(minerals)
        .where(whereClause),
    ]);

    const total = totalCountResult[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
    });
  } catch (error: any) {
    console.error("Error retrieving minerals catalog:", error);
    res.status(500).json({ error: "Failed to retrieve minerals catalog" });
  }
});

/**
 * GET /api/minerals/:idOrName
 * Retrieve single mineral by ID or Name
 */
router.get("/:idOrName", async (req: Request, res: Response): Promise<void> => {
  try {
    const rawIdOrName = Array.isArray(req.params.idOrName)
      ? req.params.idOrName[0]
      : req.params.idOrName;

    if (!rawIdOrName) {
      res.status(400).json({ error: "Invalid mineral ID or name" });
      return;
    }

    const numId = parseInt(rawIdOrName, 10);

    let mineral;
    if (!isNaN(numId)) {
      [mineral] = await refDb
        .select()
        .from(minerals)
        .where(eq(minerals.id, numId))
        .limit(1);
    } else {
      [mineral] = await refDb
        .select()
        .from(minerals)
        .where(ilike(minerals.name, rawIdOrName))
        .limit(1);
    }

    if (!mineral) {
      res.status(404).json({ error: "Mineral species not found" });
      return;
    }

    res.json(mineral);
  } catch (error: any) {
    console.error("Error retrieving mineral details:", error);
    res.status(500).json({ error: "Failed to retrieve mineral species details" });
  }
});

/**
 * POST /api/minerals/sync
 * Admin/Dev trigger to sync and update the minerals database
 */
router.post("/sync", async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await syncMineralDatabase();
    res.json({
      success: true,
      message: `Successfully synchronized ${result.addedOrUpdated} mineral species in database`,
      count: result.addedOrUpdated,
    });
  } catch (error: any) {
    console.error("Error synchronizing minerals database:", error);
    res.status(500).json({ error: "Failed to synchronize minerals database" });
  }
});

export default router;

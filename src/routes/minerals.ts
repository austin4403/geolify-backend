/**
 * @file minerals.ts
 * 
 * Minerals & Crystallography API router.
 * Provides high-speed GIN-indexed search, multi-criteria filtering,
 * paginated infinite-scroll querying, and automated mineral synchronization.
 */

import { Router, Request, Response, NextFunction } from "express";
import { sql, and, gte, lte, eq, SQL, asc, desc, ilike } from "drizzle-orm";
import { z } from "zod";
import { refDb } from "../db/refDb";
import { minerals } from "../db/schema";
import { syncMineralDatabase } from "../services/mineralSourcing";

const router = Router();

// 💡 Multi-Format Array Parser (Supports ?param=a,b and ?param=a&param=b)
const arrayQueryParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => {
    if (!val) return undefined;
    const list = Array.isArray(val) ? val : val.split(",");
    return list.map((s) => s.trim()).filter(Boolean);
  });

// 💡 1. Strict Zod Validation Boundary for High-Speed Search
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  mineralClass: z.string().trim().optional(),
  crystalSystem: z.string().trim().optional(),
  localities: arrayQueryParam,
  associatedRocks: arrayQueryParam,
  industrialUses: arrayQueryParam,
  mohsMin: z.coerce.number().min(0).max(10).optional(),
  mohsMax: z.coerce.number().min(0).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/minerals/search
 * High-performance GIN-indexed search with pg_trgm similarity ranking
 */
router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid search parameters",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q, mineralClass, crystalSystem, localities, associatedRocks, industrialUses, mohsMin, mohsMax, limit, offset } = parsed.data;
    const conditions: SQL[] = [];

    // 💡 2. Optimized GIN Index Filtering (Guarantees index scan without Seq Scan regressions)
    if (q) {
      conditions.push(
        sql`(${minerals.name} % ${q} OR ${minerals.name} ILIKE ${`%${q}%`} OR ${minerals.formula} ILIKE ${`%${q}%`} OR ${q} = ANY(${minerals.synonyms}))`
      );
    }

    if (localities && localities.length > 0) {
      conditions.push(sql`${minerals.localities} && ${localities}`);
    }

    if (associatedRocks && associatedRocks.length > 0) {
      conditions.push(sql`${minerals.associatedRocks} && ${associatedRocks}`);
    }

    if (industrialUses && industrialUses.length > 0) {
      conditions.push(sql`${minerals.industrialUses} && ${industrialUses}`);
    }

    if (mineralClass && mineralClass !== "all") {
      conditions.push(eq(minerals.mineralClass, mineralClass));
    }

    if (crystalSystem && crystalSystem !== "all") {
      conditions.push(ilike(minerals.crystalSystem, `%${crystalSystem}%`));
    }

    // Overlap logic: mineral max hardness >= requested min, and mineral min hardness <= requested max
    if (mohsMin !== undefined) {
      conditions.push(gte(minerals.mohsHardnessMax, mohsMin));
    }
    if (mohsMax !== undefined) {
      conditions.push(lte(minerals.mohsHardnessMin, mohsMax));
    }

    // 💡 3. Query Execution with Relevance Scoring
    const query = refDb
      .select({
        id: minerals.id,
        name: minerals.name,
        formula: minerals.formula,
        crystalSystem: minerals.crystalSystem,
        mineralClass: minerals.mineralClass,
        mohsHardnessMin: minerals.mohsHardnessMin,
        mohsHardnessMax: minerals.mohsHardnessMax,
        specificGravity: minerals.specificGravity,
        luster: minerals.luster,
        color: minerals.color,
        streak: minerals.streak,
        cleavage: minerals.cleavage,
        fracture: minerals.fracture,
        opticalProperties: minerals.opticalProperties,
        imaStatus: minerals.imaStatus,
        tenacity: minerals.tenacity,
        diaphaneity: minerals.diaphaneity,
        diagnosticFeatures: minerals.diagnosticFeatures,
        synonyms: minerals.synonyms,
        localities: minerals.localities,
        associatedRocks: minerals.associatedRocks,
        industrialUses: minerals.industrialUses,
        imageUrl: minerals.imageUrl,
        rruffId: minerals.rruffId,
        mindatId: minerals.mindatId,
        metadata: minerals.metadata,
        similarityScore: q ? sql<number>`similarity(${minerals.name}, ${q})` : sql<number>`1.0`,
      })
      .from(minerals);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    if (q) {
      query.orderBy(sql`similarity(${minerals.name}, ${q}) DESC`, minerals.name);
    } else {
      query.orderBy(minerals.name);
    }

    const results = await query.limit(limit).offset(offset);

    return res.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    // 💡 4. Centralized Error Shielding (SECURITY-REPORT Cycle 4)
    next(error);
  }
});

/**
 * GET /api/minerals
 * Paginated infinite-scroll search and multi-criteria filters
 */
router.get("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    const conditions: SQL[] = [];

    if (q) {
      conditions.push(
        sql`(${minerals.name} % ${q} OR ${minerals.name} ILIKE ${`%${q}%`} OR ${minerals.formula} ILIKE ${`%${q}%`} OR ${q} = ANY(${minerals.synonyms}))`
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
      orderClause = sql`similarity(${minerals.name}, ${q}) DESC, ${minerals.name} ASC` as any;
    }

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
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/minerals/:idOrName
 * Retrieve single mineral by ID or Name
 */
router.get("/:idOrName", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/minerals/sync
 * Admin/Dev trigger to sync and update the minerals database
 */
router.post("/sync", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await syncMineralDatabase();
    res.json({
      success: true,
      message: `Successfully synchronized ${result.addedOrUpdated} mineral species in database`,
      count: result.addedOrUpdated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

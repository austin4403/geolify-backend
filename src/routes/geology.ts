import { Router, Request, Response } from "express";

const geologyRouter = Router();

geologyRouter.get("/inspect", async (req: Request, res: Response): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "Invalid latitude or longitude coordinates" });
      return;
    }

    const macrostratUrl = `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lng}`;
    const fetchRes = await fetch(macrostratUrl, {
      headers: {
        "User-Agent": "GeoQuerry-GIS/1.0 (contact@geoquerry.com)",
        Accept: "application/json",
      },
    });

    if (!fetchRes.ok) {
      res.json({ coordinates: { lat, lng }, hasData: false, units: [] });
      return;
    }

    const raw: any = await fetchRes.json();
    const dataList = raw?.success?.data || [];
    const refs = raw?.success?.refs || {};

    if (dataList.length === 0) {
      res.json({ coordinates: { lat, lng }, hasData: false, units: [] });
      return;
    }

    const units = dataList.map((item: any) => {
      const sourceId = item.source_id?.toString();
      const refText = refs[sourceId] || "";

      return {
        map_id: item.map_id,
        name: item.name || item.strat_name || "Unnamed Bedrock Unit",
        strat_name: item.strat_name || undefined,
        age_interval: item.best_int_name || item.t_int_name || item.b_int_name || "Unknown Geological Age",
        top_age: item.t_age || item.t_int_age,
        bottom_age: item.b_age || item.b_int_age,
        lithology: item.lith || undefined,
        description: item.descrip || undefined,
        color: item.color || "#3b82f6",
        reference: refText || undefined,
      };
    });

    const primaryUnit =
      units.find((u: any) => u.description && u.description.length > 30) ||
      units.find((u: any) => u.strat_name) ||
      units[0];

    res.json({
      coordinates: { lat, lng },
      hasData: true,
      units,
      primaryUnit,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to inspect geological unit", details: err?.message });
  }
});

export default geologyRouter;

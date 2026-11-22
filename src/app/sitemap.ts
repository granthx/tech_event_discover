import type { MetadataRoute } from "next";
import { queryDiscoverCatalog } from "@/features/catalog/service";
import { getServerEnv } from "@/lib/env";

/**
 * Sitemap contains unfiltered Discover and active published details only (ARCHITECTURE.md).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const env = getServerEnv();
  const baseUrl = env.APP_ORIGIN.replace(/\/$/, "");
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/discover`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1.0,
    },
  ];

  const catalogResult = await queryDiscoverCatalog({ sort: "start" }, now);
  if (catalogResult.ok) {
    for (const item of catalogResult.data.items) {
      entries.push({
        url: `${baseUrl}/events/${item.id}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }
  }

  return entries;
}

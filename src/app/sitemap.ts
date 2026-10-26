import { MetadataRoute } from "next";
import { LOCALES } from "@/i18n/config";
import { MARKETING_PATHS, languageAlternates, localizedPath } from "@/i18n/marketing-routes";
import { CHANGELOG } from "@/lib/changelog/entries";

// Every public page in each language (/es/..., /en/...), each entry
// listing its translations so search engines pair them (hreflang).
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/+$/, "");
  const legal = (route: string) => route.includes("-policy") || route.includes("terms-") || route === "/data-deletion";

  // The changelog is paused (empty) until the platform is fully in production.
  return MARKETING_PATHS.filter((route) => route !== "/changelog" || CHANGELOG.length > 0).flatMap((route) =>
    LOCALES.map((locale) => ({
      url: `${baseUrl}${localizedPath(locale, route)}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: route === "" ? 1.0 : legal(route) ? 0.3 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          Object.entries(languageAlternates(route)).map(([lang, path]) => [lang, `${baseUrl}${path}`]),
        ),
      },
    })),
  );
}

import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard/", "/admin/", "/admin-panel/", "/login", "/signup"],
    },
    sitemap: `${(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/+$/, "")}/sitemap.xml`,
  };
}

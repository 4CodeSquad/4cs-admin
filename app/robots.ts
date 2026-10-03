import type { MetadataRoute } from "next";

/** Nothing on admin.4cs.al is for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}

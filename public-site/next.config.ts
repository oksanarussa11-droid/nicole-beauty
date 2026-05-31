import type { NextConfig } from "next";

// Allow next/image to optimize master photos served from Supabase Storage.
// Derived from SUPABASE_URL so it works for both local (127.0.0.1:54321) and
// prod. Master photo_url values must be Supabase Storage public URLs
// (…/storage/v1/object/public/<bucket>/<file>) for optimization to apply.
function supabaseImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const url = process.env.SUPABASE_URL;
  if (!url) return [];
  try {
    const u = new URL(url);
    return [
      {
        protocol: u.protocol.replace(":", "") as "http" | "https",
        hostname: u.hostname,
        port: u.port || "",
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImagePatterns(),
  },
};

export default nextConfig;

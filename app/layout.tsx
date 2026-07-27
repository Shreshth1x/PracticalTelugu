import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

/* eslint-disable @next/next/no-page-custom-font */

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3002";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "PalukuLingo — Learn practical Telugu",
      template: "%s",
    },
    description:
      "Learn the Telugu you need now, or start from the beginning with Mayu the peacock.",
    icons: {
      icon: "/maya-peacock.webp",
      shortcut: "/maya-peacock.webp",
    },
    openGraph: {
      title: "PalukuLingo — Telugu that feels close to home",
      description:
        "A practical Telugu crash course and a friendly path from the beginning.",
      type: "website",
      url: origin,
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "PalukuLingo with Mayu the peacock",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "PalukuLingo — Telugu that feels close to home",
      description:
        "A practical Telugu crash course and a friendly path from the beginning.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Noto+Sans+Telugu:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
        {process.env.NODE_ENV === "development" ? (
          <script
            src="https://mcp.figma.com/mcp/html-to-design/capture.js"
            async
          />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}

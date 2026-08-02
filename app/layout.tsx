import type { Metadata } from "next";
import { headers } from "next/headers";
import { LearningProvider } from "./LearningProvider";
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
  const socialImage = `${origin}/og.png?v=user-logo-3`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "PracticalTelugu | Telugu for real life",
      template: "%s",
    },
    description:
      "Get up to speed with the Telugu you’ll use with family, at the table, while visiting, and when you need help.",
    icons: {
      icon: [
        {
          url: "/practicaltelugu-mayu-favicon-32-v4.png?v=mayu-1",
          type: "image/png",
          sizes: "32x32",
        },
        {
          url: "/practicaltelugu-mayu-favicon-v4.png?v=mayu-1",
          type: "image/png",
          sizes: "64x64",
        },
      ],
      shortcut: "/practicaltelugu-mayu-favicon-32-v4.png?v=mayu-1",
      apple: {
        url: "/practicaltelugu-apple-icon-v3.png?v=approved-1",
        type: "image/png",
        sizes: "180x180",
      },
    },
    openGraph: {
      title: "PracticalTelugu | Speak useful Telugu sooner",
      description:
        "Short, practical Telugu for the real moments you’re preparing for.",
      type: "website",
      url: origin,
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "PracticalTelugu with its flowing blue peacock logo",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "PracticalTelugu | Speak useful Telugu sooner",
      description:
        "Short, practical Telugu for the real moments you’re preparing for.",
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
          href="https://fonts.googleapis.com/css2?family=Capriola&family=Nunito+Sans:opsz,wght@6..12,400;6..12,500;6..12,600;6..12,700;6..12,800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {process.env.NODE_ENV === "development" ? (
          <script
            src="https://mcp.figma.com/mcp/html-to-design/capture.js"
            async
          />
        ) : null}
      </head>
      <body>
        <LearningProvider>{children}</LearningProvider>
      </body>
    </html>
  );
}

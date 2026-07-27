import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="missing-lesson">
      <Image
        className="not-found-mayu"
        src="/mayu-encourage.webp"
        alt="Mayu pointing back toward today’s practical Telugu"
        width={210}
        height={230}
        priority
      />
      <span className="overline">NOTHING TO PRACTICE HERE</span>
      <h1>Mayu can’t find that page.</h1>
      <p>Your practical Telugu is waiting back at Today.</p>
      <Link className="primary-button" href="/">
        Return to Today
      </Link>
    </main>
  );
}

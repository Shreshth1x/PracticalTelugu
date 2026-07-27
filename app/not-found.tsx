import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="missing-lesson">
      <Image
        className="not-found-mayu"
        src="/mayu-encourage.webp"
        alt="Mayu the peacock pointing you back toward your Telugu path"
        width={210}
        height={230}
        priority
      />
      <span className="overline">THIS PATH ENDS HERE</span>
      <h1>Mayu can’t find that page.</h1>
      <p>The words you’re looking for are waiting back at Today.</p>
      <Link className="primary-button" href="/">
        Return to Today
      </Link>
    </main>
  );
}

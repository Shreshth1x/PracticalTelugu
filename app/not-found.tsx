import Link from "next/link";

export default function NotFound() {
  return (
    <main className="missing-lesson">
      <h1>That page is not available.</h1>
      <p>Your practical Telugu is waiting back at Today.</p>
      <Link className="primary-button" href="/">
        Back to today
      </Link>
    </main>
  );
}

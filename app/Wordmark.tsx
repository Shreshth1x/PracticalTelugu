export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-mark" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/practicaltelugu-peacock-mark-v3.png?v=approved-1"
          alt=""
        />
      </span>
      <span className="wordmark-name">
        practical<span>telugu</span>
      </span>
    </span>
  );
}
